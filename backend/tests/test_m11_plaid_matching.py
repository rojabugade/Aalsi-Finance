from __future__ import annotations

import os
import uuid
from datetime import date
from decimal import Decimal

import pytest
import pytest_asyncio
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.ingestion.plaid_matching import enrich_after_sync
from app.models.accounts import AccountLogical
from app.models.core import Household, User
from app.models.debt import Loan, LoanPayment
from app.models.transactions import Transaction
from app.transactions.schemas import TransactionCreate
from app.transactions import service as txn_service

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL", "postgresql+asyncpg://finance:finance@localhost:5433/finance")
HOUSEHOLD_PREFIX = "pytest-m11pm-"


@pytest_asyncio.fixture
async def engine():
    eng = create_async_engine(TEST_DATABASE_URL)
    try:
        async with eng.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception as exc:  # noqa: BLE001
        await eng.dispose()
        pytest.skip(f"no Postgres at {TEST_DATABASE_URL}: {exc}")
    yield eng
    async with eng.begin() as conn:
        await conn.execute(text("DELETE FROM household WHERE name LIKE :p"), {"p": f"{HOUSEHOLD_PREFIX}%"})
    await eng.dispose()


@pytest_asyncio.fixture
async def session(engine):
    sm = async_sessionmaker(engine, expire_on_commit=False)
    async with sm() as s:
        yield s


async def _fixture(session):
    hh = Household(name=f"{HOUSEHOLD_PREFIX}{uuid.uuid4().hex[:8]}", base_currency="USD")
    session.add(hh)
    await session.flush()
    user = User(household_id=hh.id, email=f"{uuid.uuid4().hex}@example.com", password_hash="x")
    session.add(user)
    await session.flush()
    chk = AccountLogical(household_id=hh.id, owner_user_id=user.id, label="Checking", type="checking", currency="USD", plaid_account_id="p-chk")
    card = AccountLogical(household_id=hh.id, owner_user_id=user.id, label="Card", type="credit", currency="USD", plaid_account_id="p-card")
    session.add_all([chk, card])
    loan = Loan(household_id=hh.id, owner_user_id=user.id, name="Plaid Credit Card", type="credit_card", schedule_kind="revolving", principal=Decimal("2000.00"), currency="USD", plaid_account_id="p-card")
    session.add(loan)
    await session.commit()
    return user, chk, card, loan


async def _txn(session, user, account, amount, day, external_id, flags=None, merchant="BANK"):
    return await txn_service.create_transaction(session, user, TransactionCreate(
        account_id=account.id, merchant=merchant, amount=Decimal(amount), currency="USD",
        txn_date=date(2026, 6, day), status="draft", source_channel="plaid",
        external_id=external_id, flags=flags,
    ))


@pytest.mark.asyncio
async def test_pair_match_registers_payment_and_flags_transfer(session):
    user, chk, card, loan = await _fixture(session)
    out_leg = await _txn(session, user, chk, "-250.00", 10, "t-out")
    in_leg = await _txn(session, user, card, "250.00", 11, "t-in")
    result = await enrich_after_sync(session, user, [out_leg.id, in_leg.id])
    assert result["payments_registered"] == 1
    payment = (await session.execute(select(LoanPayment).where(LoanPayment.loan_id == loan.id))).scalar_one()
    assert payment.amount == Decimal("250.00")
    assert payment.note == "plaid:t-in"
    for txn_id in (out_leg.id, in_leg.id):
        txn = await session.get(Transaction, txn_id)
        assert (txn.flags or {}).get("transfer") is True
        assert (txn.flags or {}).get("loan_id") == str(loan.id)


@pytest.mark.asyncio
async def test_pair_match_is_idempotent(session):
    user, chk, card, loan = await _fixture(session)
    out_leg = await _txn(session, user, chk, "-250.00", 10, "t-out")
    in_leg = await _txn(session, user, card, "250.00", 11, "t-in")
    await enrich_after_sync(session, user, [out_leg.id, in_leg.id])
    again = await enrich_after_sync(session, user, [out_leg.id, in_leg.id])
    assert again["payments_registered"] == 0
    payments = (await session.execute(select(LoanPayment).where(LoanPayment.loan_id == loan.id))).scalars().all()
    assert len(payments) == 1


@pytest.mark.asyncio
async def test_single_leg_pfc_match(session):
    user, chk, card, loan = await _fixture(session)
    t = await _txn(session, user, chk, "-410.00", 12, "t-pfc", flags={"plaid_pfc": {"primary": "LOAN_PAYMENTS", "detailed": "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"}})
    result = await enrich_after_sync(session, user, [t.id])
    assert result["payments_registered"] == 1
    payment = (await session.execute(select(LoanPayment).where(LoanPayment.loan_id == loan.id))).scalar_one()
    assert payment.amount == Decimal("410.00")


@pytest.mark.asyncio
async def test_single_leg_skipped_when_ambiguous(session):
    user, chk, card, loan = await _fixture(session)
    loan2 = Loan(household_id=user.household_id, owner_user_id=user.id, name="Plaid Student Loan", type="education", schedule_kind="amortizing", principal=Decimal("9000.00"), currency="USD", plaid_account_id="p-stu")
    session.add(loan2)
    await session.commit()
    t = await _txn(session, user, chk, "-410.00", 12, "t-ambig", flags={"plaid_pfc": {"primary": "LOAN_PAYMENTS", "detailed": ""}})
    result = await enrich_after_sync(session, user, [t.id])
    assert result["payments_registered"] == 0  # two candidate loans, no name signal -> don't guess


@pytest.mark.asyncio
async def test_refund_links_to_original_purchase(session):
    user, chk, card, loan = await _fixture(session)
    purchase = await _txn(session, user, card, "-89.99", 5, "t-buy", merchant="Amazon")
    refund = await _txn(session, user, card, "89.99", 15, "t-refund", merchant="Amazon")
    result = await enrich_after_sync(session, user, [refund.id])
    assert result["refunds_linked"] == 1
    refund = await session.get(Transaction, refund.id)
    purchase = await session.get(Transaction, purchase.id)
    assert (refund.flags or {}).get("refund") is True
    assert (refund.flags or {}).get("refund_of") == str(purchase.id)
    assert (purchase.flags or {}).get("refunded_by") == str(refund.id)


@pytest.mark.asyncio
async def test_unmatched_credit_not_flagged_refund(session):
    """A positive inflow with a merchant but no matching purchase must NOT be
    called a refund — it could be a Zelle from a friend, cashback, or a
    reimbursement. Over-flagging made analytics subtract it from spend."""
    user, chk, card, loan = await _fixture(session)
    credit = await _txn(session, user, card, "12.00", 15, "t-credit", merchant="RandomShop")
    result = await enrich_after_sync(session, user, [credit.id])
    assert result["refunds_linked"] == 0
    credit = await session.get(Transaction, credit.id)
    assert (credit.flags or {}).get("refund") is not True
    assert "refund_of" not in (credit.flags or {})


@pytest.mark.asyncio
async def test_pfc_classifies_income_and_transfers_off_spend(session):
    """Real bank inflows (paychecks, Zelle/account transfers) arrive with only a
    plaid_pfc; enrichment must tag them income/transfer so analytics never counts
    them as spend."""
    user, chk, card, loan = await _fixture(session)
    paycheck = await _txn(session, user, chk, "3200.00", 5, "t-income", merchant="ACME PAYROLL",
                          flags={"plaid_pfc": {"primary": "INCOME", "detailed": "INCOME_WAGES"}})
    zelle_in = await _txn(session, user, chk, "150.00", 6, "t-tin", merchant="ZELLE FROM FRIEND",
                          flags={"plaid_pfc": {"primary": "TRANSFER_IN", "detailed": "TRANSFER_IN_ACCOUNT_TRANSFER"}})
    zelle_out = await _txn(session, user, chk, "-75.00", 7, "t-tout", merchant="ZELLE TO FRIEND",
                           flags={"plaid_pfc": {"primary": "TRANSFER_OUT", "detailed": "TRANSFER_OUT_ACCOUNT_TRANSFER"}})
    groceries = await _txn(session, user, chk, "-48.67", 8, "t-spend", merchant="INDIA BAZAAR",
                           flags={"plaid_pfc": {"primary": "GENERAL_MERCHANDISE", "detailed": "GENERAL_MERCHANDISE_SUPERSTORES"}})

    await enrich_after_sync(session, user, [paycheck.id, zelle_in.id, zelle_out.id, groceries.id])

    assert (await session.get(Transaction, paycheck.id)).flags.get("type") == "income"
    assert (await session.get(Transaction, zelle_in.id)).flags.get("transfer") is True
    assert (await session.get(Transaction, zelle_out.id)).flags.get("transfer") is True
    # A real purchase stays untouched — still counts as spend.
    grocery_flags = (await session.get(Transaction, groceries.id)).flags or {}
    assert grocery_flags.get("transfer") is None and grocery_flags.get("type") != "income"
