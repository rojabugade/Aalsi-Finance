"""Post-sync enrichment for Plaid transactions: loan/credit-card payment
detection (auto-registered, undoable via loan payment delete) and refund
matching. Called from plaid_sync; must never raise into the sync path.

Sign conventions (canonical storage): money out is negative. A payment shows
up as a negative leg on a depository account and a positive leg on the
credit/loan account it pays down.
"""
from __future__ import annotations

import logging
import uuid
from datetime import timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.loans import service as loans_service
from app.loans.schemas import LoanPaymentIn
from app.models.accounts import AccountLogical
from app.models.core import User
from app.models.debt import Loan, LoanPayment
from app.models.transactions import Transaction

logger = logging.getLogger(__name__)

PAIR_WINDOW_DAYS = 3
REFUND_WINDOW_DAYS = 90
_LIABILITY_TYPES = {"credit", "loan"}
_DEPOSITORY_TYPES = {"checking", "savings", "cash"}


async def enrich_after_sync(session: AsyncSession, user: User, txn_ids: list[uuid.UUID]) -> dict:
    counts = {"payments_registered": 0, "refunds_linked": 0}
    if not txn_ids:
        return counts
    txns = list((await session.execute(
        select(Transaction).where(Transaction.household_id == user.household_id, Transaction.id.in_(txn_ids))
    )).scalars().all())
    accounts = {a.id: a for a in (await session.execute(
        select(AccountLogical).where(AccountLogical.household_id == user.household_id)
    )).scalars().all()}
    loans_by_plaid = {l.plaid_account_id: l for l in (await session.execute(
        select(Loan).where(Loan.household_id == user.household_id, Loan.plaid_account_id.is_not(None))
    )).scalars().all() if l.plaid_account_id}

    counts["payments_registered"] += await _match_payment_pairs(session, user, txns, accounts, loans_by_plaid)
    counts["payments_registered"] += await _match_single_leg_payments(session, user, txns, accounts, loans_by_plaid)
    counts["refunds_linked"] += await _match_refunds(session, user, txns, accounts)
    # Runs last: the matchers above set precise loan/refund flags; this fills the
    # remaining gap so paychecks and plain money-movement never count as spend.
    _classify_by_pfc(txns)
    await session.commit()
    return counts


# Plaid's personal_finance_category is authoritative for spend vs money-movement.
# INCOME must show as income; transfers (P2P/account/card payments) are money
# movement, not spend — see analytics._aggregate, which excludes both.
_INCOME_PFC = {"INCOME"}
_TRANSFER_PFC = {"TRANSFER_IN", "TRANSFER_OUT", "LOAN_PAYMENTS"}


def _classify_by_pfc(txns: list[Transaction]) -> None:
    for t in txns:
        flags = t.flags or {}
        if flags.get("transfer") or flags.get("refund") or flags.get("type") == "income":
            continue  # already classified precisely by a matcher above
        primary = (flags.get("plaid_pfc") or {}).get("primary")
        if primary in _INCOME_PFC:
            _set_flags(t, type="income")
        elif primary in _TRANSFER_PFC:
            _set_flags(t, transfer=True)


def _set_flags(txn: Transaction, **new: object) -> None:
    txn.flags = {**(txn.flags or {}), **new}
    flag_modified(txn, "flags")


async def _payment_exists(session: AsyncSession, note: str) -> bool:
    row = (await session.execute(select(LoanPayment.id).where(LoanPayment.note == note))).first()
    return row is not None


async def _register(session: AsyncSession, user: User, loan: Loan, amount: Decimal, payment_date, note: str) -> bool:
    if await _payment_exists(session, note):
        return False
    await loans_service.record_payment(session, user, loan.id, LoanPaymentIn(payment_date=payment_date, amount=amount, note=note))
    return True


async def _match_payment_pairs(session, user, txns, accounts, loans_by_plaid) -> int:
    """Positive leg on a credit/loan account + equal-magnitude negative leg on a
    depository account within PAIR_WINDOW_DAYS -> loan payment."""
    registered = 0
    liability_legs = [
        t for t in txns
        if t.account_id and (a := accounts.get(t.account_id)) and a.type in _LIABILITY_TYPES
        and t.amount > 0 and not (t.flags or {}).get("transfer")
    ]
    for leg in liability_legs:
        account = accounts[leg.account_id]
        loan = loans_by_plaid.get(account.plaid_account_id or "")
        if loan is None:
            continue
        # The other leg may predate this sync batch — search the whole ledger.
        window_lo = leg.txn_date - timedelta(days=PAIR_WINDOW_DAYS)
        window_hi = leg.txn_date + timedelta(days=PAIR_WINDOW_DAYS)
        candidates = list((await session.execute(
            select(Transaction).where(
                Transaction.household_id == user.household_id,
                Transaction.amount == -leg.amount,
                Transaction.txn_date >= window_lo,
                Transaction.txn_date <= window_hi,
                Transaction.id != leg.id,
            )
        )).scalars().all())
        other = next(
            (c for c in candidates
             if c.account_id and (a := accounts.get(c.account_id)) and a.type in _DEPOSITORY_TYPES
             and not (c.flags or {}).get("transfer")),
            None,
        )
        if other is None:
            continue
        note = f"plaid:{leg.external_id or leg.id}"
        if await _register(session, user, loan, leg.amount, leg.txn_date, note):
            registered += 1
        _set_flags(leg, transfer=True, loan_payment=True, loan_id=str(loan.id))
        _set_flags(other, transfer=True, loan_payment=True, loan_id=str(loan.id))
    return registered


async def _match_single_leg_payments(session, user, txns, accounts, loans_by_plaid) -> int:
    """Depository outflow Plaid labels LOAN_PAYMENTS -> register when we can
    pin down exactly one loan (never guess between several)."""
    registered = 0
    plaid_loans = list(loans_by_plaid.values())
    for t in txns:
        flags = t.flags or {}
        if flags.get("transfer") or flags.get("loan_payment"):
            continue
        if (flags.get("plaid_pfc") or {}).get("primary") != "LOAN_PAYMENTS":
            continue
        account = accounts.get(t.account_id) if t.account_id else None
        if account is None or account.type not in _DEPOSITORY_TYPES or t.amount >= 0:
            continue
        loan = _resolve_loan(t, plaid_loans, flags)
        if loan is None:
            continue
        note = f"plaid:{t.external_id or t.id}"
        if await _register(session, user, loan, -t.amount, t.txn_date, note):
            registered += 1
        _set_flags(t, transfer=True, loan_payment=True, loan_id=str(loan.id))
    return registered


def _resolve_loan(txn: Transaction, loans: list[Loan], flags: dict) -> Loan | None:
    if len(loans) == 1:
        return loans[0]
    detailed = ((flags.get("plaid_pfc") or {}).get("detailed") or "").upper()
    if "CREDIT_CARD" in detailed:
        cards = [l for l in loans if l.type == "credit_card"]
        if len(cards) == 1:
            return cards[0]
    haystack = (txn.notes or "").lower()  # Plaid puts the raw descriptor in notes
    named = [l for l in loans if any(tok for tok in l.name.lower().split() if len(tok) > 3 and tok in haystack)]
    if len(named) == 1:
        return named[0]
    return None  # ambiguous -> leave it; user can record manually


async def _match_refunds(session, user, txns, accounts) -> int:
    """Merchant-side credits: flag as refund and link to the matching purchase
    (same merchant, equal magnitude, within REFUND_WINDOW_DAYS before)."""
    linked = 0
    for t in txns:
        flags = t.flags or {}
        if t.amount <= 0 or flags.get("transfer") or flags.get("refund"):
            continue
        if (flags.get("plaid_pfc") or {}).get("primary") in ("INCOME", "TRANSFER_IN"):
            continue  # paychecks / incoming transfers are not merchant refunds
        account = accounts.get(t.account_id) if t.account_id else None
        if account is not None and account.type == "loan":
            continue  # loan inflows are payments/disbursements, not refunds
        if t.merchant_id is None:
            continue  # no merchant signal — leave for manual review
        original = (await session.execute(
            select(Transaction).where(
                Transaction.household_id == user.household_id,
                Transaction.merchant_id == t.merchant_id,
                Transaction.amount == -t.amount,
                Transaction.txn_date <= t.txn_date,
                Transaction.txn_date >= t.txn_date - timedelta(days=REFUND_WINDOW_DAYS),
                Transaction.id != t.id,
            ).order_by(Transaction.txn_date.desc())
        )).scalars().first()
        if original is not None and not (original.flags or {}).get("refunded_by"):
            _set_flags(t, refund=True, refund_of=str(original.id))
            _set_flags(original, refunded_by=str(t.id))
            linked += 1
        # No matching purchase -> leave unflagged. A bare inflow with a merchant
        # can be a Zelle from a friend, cashback, or a reimbursement; calling it
        # a refund made analytics subtract it from spend. _classify_by_pfc still
        # gets a shot at typing it income/transfer.
    return linked
