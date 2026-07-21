from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal
from difflib import SequenceMatcher
from statistics import median

from fastapi import HTTPException, status
from sqlalchemy import cast, delete, or_, select, update
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession

from app.analyst.memory.ingest import enqueue_index_source
from app.auth.deps import scoped_query
from app.fx import service as fx_service
from app.models.accounts import AccountLogical, PaymentMethod
from app.models.core import User
from app.models.documents import Document
from app.models.transactions import (
    Category,
    LineItem,
    LineItemTag,
    Merchant,
    RecurringSeries,
    Rule,
    Tag,
    Transaction,
    TransactionTag,
)
from app.transactions.schemas import (
    CategoryIn,
    LineItemIn,
    RuleIn,
    SplitIn,
    TagIn,
    TransactionCreate,
    TransactionPatch,
)


class NotFound(Exception):
    pass


def _money(value: Decimal | str | int | float | None, default: Decimal | None = None) -> Decimal:
    if value is None:
        if default is None:
            raise ValueError("money value is required")
        return default
    return Decimal(str(value)).quantize(Decimal("0.01"))


def _currency(value: str | None, default: str = "USD") -> str:
    return (value or default).upper()[:3]


async def _household_base_currency(session: AsyncSession, household_id: uuid.UUID) -> str:
    return await fx_service.household_base_currency(session, household_id)


async def _snapshot_base_amount(
    session: AsyncSession,
    household_id: uuid.UUID,
    amount: Decimal,
    currency: str,
    txn_date: date,
) -> tuple[Decimal, Decimal]:
    try:
        base_amount, fx_rate, _rate_date, _base = await fx_service.convert_to_household_base(
            session, household_id, amount, currency, txn_date
        )
    except fx_service.FXRateUnavailable as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    return base_amount, fx_rate


async def get_or_create_merchant(
    session: AsyncSession,
    household_id: uuid.UUID,
    name: str | None,
    merchant_id: uuid.UUID | None = None,
) -> Merchant | None:
    if merchant_id is not None:
        merchant = await session.get(Merchant, merchant_id)
        if merchant is None or merchant.household_id not in (None, household_id):
            raise NotFound("Merchant not found")
        return merchant
    if not name:
        return None
    # Cap at the merchant.canonical_name column width. Real bank/Plaid descriptors
    # (long ACH/Zelle/transfer memos) can exceed 255 chars; without this the INSERT
    # raises StringDataRightTruncationError and fails the whole sync.
    canonical = " ".join(name.upper().split())[:255]
    stmt = select(Merchant).where(
        Merchant.canonical_name == canonical,
        or_(Merchant.household_id == household_id, Merchant.household_id.is_(None)),
    )
    merchant = (await session.execute(stmt)).scalars().first()
    if merchant is not None:
        return merchant
    merchant = Merchant(household_id=household_id, canonical_name=canonical, aliases=[])
    session.add(merchant)
    await session.flush()
    return merchant


async def apply_categorization(session: AsyncSession, txn: Transaction, merchant: Merchant | None) -> None:
    """Rules -> merchant default -> Plaid PFC. When all three miss, the txn stays
    uncategorized on purpose: an honest "needs category" beats a confidently wrong
    guess (a fuzzy merchant-name-vs-category-name matcher used to live here and
    routed long ACH descriptors to random categories)."""
    category_id = await _category_from_rules(session, txn, merchant)
    if category_id is None and merchant and merchant.default_category_id:
        category_id = merchant.default_category_id
    if category_id is None:
        category_id = await _category_from_plaid_pfc(session, txn)
    if category_id is not None:
        txn.category_id = category_id


async def _category_from_rules(
    session: AsyncSession, txn: Transaction, merchant: Merchant | None
) -> uuid.UUID | None:
    stmt = (
        select(Rule)
        .where(Rule.household_id == txn.household_id)
        .order_by(Rule.priority.desc(), Rule.created_at.asc())
    )
    for rule in (await session.execute(stmt)).scalars().all():
        if _rule_matches(rule.matcher, txn, merchant):
            raw = rule.action.get("set_category") or rule.action.get("category_id")
            if raw:
                return uuid.UUID(str(raw))
    return None


def _rule_matches(matcher: dict, txn: Transaction, merchant: Merchant | None) -> bool:
    field = matcher.get("field")
    op = matcher.get("op", "eq")
    target = matcher.get("value")
    value: str | Decimal | None
    if field == "merchant":
        value = merchant.canonical_name if merchant else None
    elif field in {"description", "notes"}:
        value = txn.notes
    elif field == "amount":
        value = txn.amount
    else:
        return False

    if value is None:
        return False
    if field == "amount":
        amount = Decimal(str(value))
        target_amount = Decimal(str(target))
        return {
            "eq": amount == target_amount,
            "gte": amount >= target_amount,
            "lte": amount <= target_amount,
        }.get(op, False)
    lhs = str(value).lower()
    rhs = str(target).lower()
    return lhs == rhs if op == "eq" else rhs in lhs if op == "contains" else False


# Plaid personal_finance_category primary -> search terms against the household's
# category tree. Deliberately fuzzy: household category names vary.
# Each primary must have at least one term that matches a system category name
# via ILIKE %term%; terms that match nothing are dead weight.
_PFC_SEARCH_TERMS: dict[str, list[str]] = {
    "FOOD_AND_DRINK": ["food", "dining", "restaurant", "grocer"],
    "GENERAL_MERCHANDISE": ["shopping", "merchandise"],
    "TRANSPORTATION": ["transport", "car", "gas", "fuel"],
    "TRAVEL": ["travel"],
    "RENT_AND_UTILITIES": ["utilit", "rent", "bill", "housing"],
    "ENTERTAINMENT": ["entertainment", "fun", "leisure"],
    "PERSONAL_CARE": ["personal", "care", "beauty"],
    "GENERAL_SERVICES": ["miscellaneous", "business"],
    "MEDICAL": ["health", "medical"],
    "HOME_IMPROVEMENT": ["home"],
    "EDUCATION": ["education", "school"],
    "INCOME": ["income", "salary", "interest", "dividend"],
    "INSURANCE": ["insurance"],
    "BANK_FEES": ["bank fees", "interest charges"],
    "TAX": ["government & fees", "tax"],
    "TRANSFER_OUT": ["transfer", "cross-border transfer", "internal transfer"],
    "TRANSFER_IN": ["income", "transfer"],
    "GOVERNMENT_AND_NON_PROFIT": ["government", "fees"],
    "LOAN_PAYMENTS": ["credit card payment", "transfer"],
    "LOAN_DISBURSEMENTS": ["income", "transfer"],
}


async def _category_from_plaid_pfc(session: AsyncSession, txn: Transaction) -> uuid.UUID | None:
    """Last-resort categorization from Plaid's personal_finance_category flag
    (rules, merchant defaults, and name similarity all get first shot). Tries
    the primary PFC first, then falls back to extracting words from the
    detailed PFC (e.g. GENERAL_SERVICES_EDUCATION → "education")."""
    primary = ((txn.flags or {}).get("plaid_pfc") or {}).get("primary")
    detailed_raw = (((txn.flags or {}).get("plaid_pfc") or {}).get("detailed") or "").upper()
    terms = _PFC_SEARCH_TERMS.get(primary or "")
    if primary == "GOVERNMENT_AND_NON_PROFIT" and "DONATION" in detailed_raw:
        terms = ["gifts", "donations"]  # charity, not USCIS/DMV/tax fees
    if terms:
        result = await _search_category_by_terms(session, txn.household_id, terms)
        if result is not None:
            return result

    # Primary didn't match — try extracting keywords from the detailed PFC.
    # Example: GENERAL_SERVICES_EDUCATION → education, MEDICAL_DENTAL → dental.
    detailed = ((txn.flags or {}).get("plaid_pfc") or {}).get("detailed") or ""
    if detailed:
        # Split on underscores, filter to meaningful words (>3 chars), and
        # search category names for matches.
        words = [w.lower() for w in detailed.split("_") if len(w) > 3]
        if words:
            result = await _search_category_by_terms(session, txn.household_id, words)
            if result is not None:
                return result
    return None


async def _search_category_by_terms(
    session: AsyncSession, household_id: uuid.UUID, terms: list[str]
) -> uuid.UUID | None:
    """Search categories by ILIKE term matching. Finds both top-level categories
    and subcategories; when a subcategory matches, its parent category id is
    returned so transactions are always assigned to a category (not a subcategory)."""
    for term in terms:
        row = (await session.execute(
            select(Category).where(
                or_(Category.household_id == household_id, Category.household_id.is_(None)),
                Category.name.ilike(f"%{term}%"),
            ).order_by(Category.household_id.is_(None))  # household's own categories win over globals
            .limit(1)
        )).scalars().first()
        if row is not None:
            # If we matched a subcategory, resolve to its parent category
            if row.kind == "subcategory" and row.parent_id:
                parent = await session.get(Category, row.parent_id)
                if parent is not None and parent.kind == "category":
                    return parent.id
            if row.kind == "category":
                return row.id
    return None


async def create_transaction(
    session: AsyncSession, user: User, data: TransactionCreate, update_on_conflict: bool = False
) -> Transaction:
    """Create a transaction, deduplicating on (source_channel, external_id).

    When a matching row already exists, the default is to leave it untouched and
    return it (idempotent ingest). Pass ``update_on_conflict=True`` — used by the
    Plaid ``modified`` sync path — to instead apply the provider's new amount/date/
    merchant to the existing row while preserving user edits (category, status).
    """
    if data.status not in {"draft", "confirmed"}:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Invalid transaction status")
    if data.external_id:
        existing = await _dedup(session, user.household_id, data.source_channel, data.external_id)
        if existing is not None:
            if update_on_conflict:
                return await _apply_external_update(session, user, existing, data)
            return existing
    merchant = await get_or_create_merchant(session, user.household_id, data.merchant, data.merchant_id)
    amount = _money(data.amount)
    currency = _currency(data.currency)
    if data.source_channel == "plaid":
        duplicate = await _plaid_fingerprint_dedup(session, user.household_id, data, merchant, amount)
        if duplicate is not None:
            return duplicate
    base_amount, fx_rate = await _snapshot_base_amount(session, user.household_id, amount, currency, data.txn_date)
    await _validate_widget_links(session, user, data.payment_method_id, data.recurring_series_id)
    await _validate_transaction_refs(
        session, user, data.account_id, data.category_id, data.source_document_id, data.line_items
    )
    txn = Transaction(
        household_id=user.household_id,
        account_id=data.account_id,
        payment_method_id=data.payment_method_id,
        recurring_series_id=data.recurring_series_id,
        owner_user_id=user.id,
        merchant_id=merchant.id if merchant else None,
        amount=amount,
        currency=currency,
        base_amount=base_amount,
        fx_rate=fx_rate,
        txn_date=data.txn_date,
        category_id=data.category_id,
        status=data.status,
        source_document_id=data.source_document_id,
        source_channel=data.source_channel,
        is_shared=data.is_shared,
        flags=data.flags or {},
        notes=data.notes,
        confidence=data.confidence,
        external_id=data.external_id,
    )
    session.add(txn)
    await session.flush()
    await add_line_items(session, txn, data.line_items)
    if txn.category_id is None:
        await apply_categorization(session, txn, merchant)
    await detect_recurring(session, txn)
    await session.commit()
    await session.refresh(txn)
    if txn.status == "confirmed":
        enqueue_index_source(user.household_id, "transaction", [txn.id])
    return txn


async def _plaid_fingerprint_dedup(
    session: AsyncSession,
    household_id: uuid.UUID,
    data: TransactionCreate,
    merchant: Merchant | None,
    amount: Decimal,
) -> Transaction | None:
    """Second-line dedup for Plaid rows. A fresh Link flow for an already-linked
    bank issues brand-new transaction_ids for the same underlying transactions, so
    (source_channel, external_id) dedup misses and the whole history re-imports.
    Match on the stable facts instead: account, date, amount, merchant. Restricted
    to rows from an earlier sync document so two genuine identical purchases
    arriving in the same batch are never collapsed."""
    if data.account_id is None:
        return None
    rows = (await session.execute(
        select(Transaction).where(
            Transaction.household_id == household_id,
            Transaction.source_channel == "plaid",
            Transaction.account_id == data.account_id,
            Transaction.txn_date == data.txn_date,
            Transaction.amount == amount,
        )
    )).scalars().all()
    for row in rows:
        if data.source_document_id is not None and row.source_document_id == data.source_document_id:
            continue  # same sync batch — could be a real duplicate purchase
        if data.external_id and row.external_id == data.external_id:
            continue  # primary dedup's job
        row_merchant_id = row.merchant_id
        if merchant is not None and row_merchant_id == merchant.id:
            return row
        if merchant is None and row_merchant_id is None:
            return row
    return None


def _tombstone_key(source_channel: str | None, external_id: str) -> str:
    """Stable key for an external id that has been merged away, encoding its
    originating channel so the survivor can still be matched after a merge."""
    return f"{source_channel or ''}::{external_id}"


async def _dedup(
    session: AsyncSession,
    household_id: uuid.UUID,
    source_channel: str | None,
    external_id: str | None,
) -> Transaction | None:
    if not external_id:
        return None
    stmt = select(Transaction).where(
        Transaction.household_id == household_id,
        Transaction.source_channel == source_channel,
        Transaction.external_id == external_id,
    )
    row = (await session.execute(stmt)).scalar_one_or_none()
    if row is not None:
        return row
    # The row carrying this external_id may have been merged into another txn.
    # Merge records the swallowed external_ids as tombstones on the survivor's
    # flags so a later sync page (re-add / modified) resolves here, not a dupe.
    key = _tombstone_key(source_channel, external_id)
    tomb = select(Transaction).where(
        Transaction.household_id == household_id,
        Transaction.flags["merged_external_ids"].op("@>")(cast([key], JSONB)),
    )
    return (await session.execute(tomb)).scalars().first()


async def _apply_external_update(
    session: AsyncSession, user: User, txn: Transaction, data: TransactionCreate
) -> Transaction:
    """Apply a provider ``modified`` event to an existing transaction. Updates the
    provider-owned facts (amount, currency, date, merchant, notes, confidence,
    pending/plaid_pfc flags, draft->confirmed promotion) and re-snapshots the base
    amount; deliberately preserves user-owned fields (category, other flags,
    is_shared, and a status the user already advanced)."""
    txn.amount = _money(data.amount)
    txn.currency = _currency(data.currency)
    txn.txn_date = data.txn_date
    if data.merchant is not None or data.merchant_id is not None:
        merchant = await get_or_create_merchant(session, user.household_id, data.merchant, data.merchant_id)
        if merchant is not None:
            txn.merchant_id = merchant.id
    if data.notes is not None:
        txn.notes = data.notes
    if data.confidence is not None:
        txn.confidence = data.confidence
    # Provider-side status promotion: a pending Plaid txn posts as a `modified`
    # event with status confirmed. Only ever promotes draft -> confirmed; a row
    # the user already confirmed (or edited) is left alone.
    promoted = data.status == "confirmed" and txn.status == "draft"
    if promoted:
        txn.status = "confirmed"
    incoming_flags = data.flags or {}
    flags = dict(txn.flags or {})
    if "plaid_pfc" in incoming_flags:
        flags["plaid_pfc"] = incoming_flags["plaid_pfc"]
    if incoming_flags.get("pending"):
        flags["pending"] = True
    else:
        flags.pop("pending", None)
    txn.flags = flags
    txn.base_amount, txn.fx_rate = await _snapshot_base_amount(
        session, user.household_id, txn.amount, txn.currency, txn.txn_date
    )
    await session.commit()
    await session.refresh(txn)
    if promoted:
        enqueue_index_source(user.household_id, "transaction", [txn.id])
    return txn


async def delete_external_transactions(
    session: AsyncSession,
    user: User,
    source_channel: str | None,
    external_ids: list[str],
) -> int:
    """Delete transactions a provider reported as ``removed`` (e.g. a reversed
    Plaid pending charge). Matches on (source_channel, external_id) within the
    household; line items cascade at the DB level. Returns rows deleted."""
    ids = [e for e in external_ids if e]
    if not ids:
        return 0
    result = await session.execute(
        delete(Transaction).where(
            Transaction.household_id == user.household_id,
            Transaction.source_channel == source_channel,
            Transaction.external_id.in_(ids),
        )
    )
    return result.rowcount or 0


async def add_line_items(session: AsyncSession, txn: Transaction, items: list[LineItemIn]) -> list[LineItem]:
    rows: list[LineItem] = []
    for item in items:
        # Line items can carry a category id straight from client input; keep it
        # scoped to the transaction's household (or a global category).
        await _validate_category_ref(session, txn.household_id, item.item_type_category_id)
        row = LineItem(
            transaction_id=txn.id,
            name=item.name,
            amount=_money(item.amount),
            quantity=item.quantity,
            item_type_category_id=item.item_type_category_id,
            confidence=item.confidence,
        )
        session.add(row)
        rows.append(row)
    if rows:
        await session.flush()
    return rows


async def list_transactions(session: AsyncSession, user: User) -> list[Transaction]:
    stmt = scoped_query(Transaction, user).order_by(Transaction.txn_date.desc(), Transaction.created_at.desc())
    return list((await session.execute(stmt)).scalars().all())


async def get_transaction(session: AsyncSession, user: User, transaction_id: uuid.UUID) -> Transaction:
    txn = (await session.execute(scoped_query(Transaction, user).where(Transaction.id == transaction_id))).scalar_one_or_none()
    if txn is None:
        raise NotFound("Transaction not found")
    return txn


async def line_items_for(session: AsyncSession, transaction_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[LineItem]]:
    if not transaction_ids:
        return {}
    rows = (await session.execute(select(LineItem).where(LineItem.transaction_id.in_(transaction_ids)))).scalars().all()
    out: dict[uuid.UUID, list[LineItem]] = defaultdict(list)
    for row in rows:
        out[row.transaction_id].append(row)
    return out


async def merchant_names_for(session: AsyncSession, merchant_ids: list[uuid.UUID]) -> dict[uuid.UUID, str]:
    if not merchant_ids:
        return {}
    rows = (await session.execute(select(Merchant).where(Merchant.id.in_(merchant_ids)))).scalars().all()
    return {m.id: m.canonical_name for m in rows}


async def patch_transaction(
    session: AsyncSession, user: User, transaction_id: uuid.UUID, data: TransactionPatch
) -> Transaction:
    txn = await get_transaction(session, user, transaction_id)
    before_category = txn.category_id
    merchant = None
    if data.merchant is not None or data.merchant_id is not None:
        merchant = await get_or_create_merchant(session, user.household_id, data.merchant, data.merchant_id)
        txn.merchant_id = merchant.id if merchant else None
    elif txn.merchant_id:
        merchant = await session.get(Merchant, txn.merchant_id)

    changed = data.model_dump(exclude_unset=True)
    await _validate_transaction_refs(
        session,
        user,
        changed.get("account_id") if "account_id" in changed else None,
        changed.get("category_id") if "category_id" in changed else None,
        None,
    )
    if "payment_method_id" in changed or "recurring_series_id" in changed:
        await _validate_widget_links(
            session,
            user,
            changed.get("payment_method_id", txn.payment_method_id),
            changed.get("recurring_series_id", txn.recurring_series_id),
        )
        for field in ("payment_method_id", "recurring_series_id"):
            if field in changed:
                setattr(txn, field, changed[field])
    for field in (
        "account_id", "amount", "currency", "txn_date", "category_id", "status", "is_shared", "flags", "notes", "confidence",
    ):
        value = getattr(data, field)
        if value is not None:
            setattr(txn, field, _currency(value) if field == "currency" else _money(value) if field in {"amount", "base_amount"} else value)
    if {"amount", "currency", "txn_date"} & changed.keys() or txn.base_amount is None or txn.fx_rate is None:
        txn.base_amount, txn.fx_rate = await _snapshot_base_amount(
            session, user.household_id, txn.amount, txn.currency, txn.txn_date
        )
    if data.category_id is not None and data.category_id != before_category and merchant is not None:
        await remember_category_rule(session, user.household_id, merchant, data.category_id)
    await detect_recurring(session, txn)
    await session.commit()
    await session.refresh(txn)
    return txn


async def _validate_category_ref(
    session: AsyncSession, household_id: uuid.UUID, category_id: uuid.UUID | None
) -> None:
    """A transaction/line-item may reference the household's own category or a global
    (system, household_id IS NULL) one — nothing else. Blocks cross-tenant reference
    injection where a client attaches another household's category id."""
    if category_id is None:
        return
    cat = await session.get(Category, category_id)
    if cat is None or cat.household_id not in (None, household_id):
        raise NotFound("Category not found")


async def _validate_transaction_refs(
    session: AsyncSession,
    user: User,
    account_id: uuid.UUID | None,
    category_id: uuid.UUID | None,
    source_document_id: uuid.UUID | None,
    line_items: list[LineItemIn] | None = None,
) -> None:
    """Confirm every client-supplied FK belongs to the caller's household before it
    is written. Without this a member could point a transaction at another
    household's account/category/document id (data-integrity break + disclosure when
    those ids are later resolved to names)."""
    if account_id is not None:
        row = (await session.execute(
            scoped_query(AccountLogical, user).where(AccountLogical.id == account_id)
        )).scalar_one_or_none()
        if row is None:
            raise NotFound("Account not found")
    if source_document_id is not None:
        row = (await session.execute(
            scoped_query(Document, user).where(Document.id == source_document_id)
        )).scalar_one_or_none()
        if row is None:
            raise NotFound("Source document not found")
    await _validate_category_ref(session, user.household_id, category_id)
    for item in line_items or []:
        await _validate_category_ref(session, user.household_id, item.item_type_category_id)


async def _validate_widget_links(
    session: AsyncSession,
    user: User,
    payment_method_id: uuid.UUID | None,
    recurring_series_id: uuid.UUID | None,
) -> None:
    for model, row_id, label in (
        (PaymentMethod, payment_method_id, "Payment method"),
        (RecurringSeries, recurring_series_id, "Recurring series"),
    ):
        if row_id is None:
            continue
        row = (await session.execute(scoped_query(model, user).where(model.id == row_id))).scalar_one_or_none()
        if row is None:
            raise NotFound(f"{label} not found")


async def delete_transaction(session: AsyncSession, user: User, transaction_id: uuid.UUID) -> None:
    txn = await get_transaction(session, user, transaction_id)
    await session.delete(txn)
    await session.commit()


async def confirm_transaction(session: AsyncSession, user: User, transaction_id: uuid.UUID) -> Transaction:
    from app.analytics.service import refresh_rollups  # local import avoids an import cycle

    txn = await get_transaction(session, user, transaction_id)
    txn.status = "confirmed"
    await session.commit()
    # Confirm is the only event that changes the analytics rollup's inputs (M7 spec).
    await refresh_rollups(session)
    await session.refresh(txn)
    enqueue_index_source(user.household_id, "transaction", [txn.id])
    return txn


async def split_transaction(session: AsyncSession, user: User, transaction_id: uuid.UUID, data: SplitIn) -> list[Transaction]:
    txn = await get_transaction(session, user, transaction_id)
    total = sum((_money(p.amount) for p in data.parts), Decimal("0.00"))
    if total != txn.amount:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Split parts must sum to transaction amount")
    await session.delete(txn)
    rows = []
    base_currency = await _household_base_currency(session, user.household_id)
    for idx, part in enumerate(data.parts, start=1):
        merchant = await get_or_create_merchant(session, user.household_id, part.merchant, txn.merchant_id)
        row = Transaction(
            household_id=txn.household_id,
            account_id=txn.account_id,
            owner_user_id=txn.owner_user_id,
            merchant_id=merchant.id if merchant else txn.merchant_id,
            amount=_money(part.amount),
            currency=txn.currency or base_currency,
            base_amount=_money(_money(part.amount) * Decimal(str(txn.fx_rate or 1))),
            fx_rate=txn.fx_rate or Decimal("1"),
            txn_date=txn.txn_date,
            category_id=part.category_id or txn.category_id,
            status="draft",
            source_document_id=txn.source_document_id,
            source_channel=txn.source_channel,
            is_shared=txn.is_shared,
            flags=part.flags or txn.flags or {},
            notes=part.notes or f"Split from {txn.id} part {idx}",
            confidence=txn.confidence,
            external_id=f"{txn.external_id}:split:{idx}" if txn.external_id else None,
        )
        session.add(row)
        rows.append(row)
    await session.commit()
    return rows


async def merge_transactions(session: AsyncSession, user: User, ids: list[uuid.UUID], notes: str | None) -> Transaction:
    txns = [await get_transaction(session, user, tid) for tid in ids]
    first = txns[0]
    total = sum((t.amount for t in txns), Decimal("0.00"))
    first.amount = total
    first.base_amount = sum((_money(t.base_amount or t.amount) for t in txns), Decimal("0.00"))
    first.status = "draft"
    first.notes = notes or first.notes
    # Preserve the dedup keys of the rows we're about to delete so a later ingest
    # page (a re-add or a `modified` event referencing them) resolves to this
    # survivor instead of re-creating a duplicate. Carry forward any tombstones
    # the merged rows themselves already held.
    flags = dict(first.flags or {})
    tombstones = set(flags.get("merged_external_ids") or [])
    for txn in txns[1:]:
        if txn.external_id:
            tombstones.add(_tombstone_key(txn.source_channel, txn.external_id))
        tombstones.update((txn.flags or {}).get("merged_external_ids") or [])
        await session.execute(update(LineItem).where(LineItem.transaction_id == txn.id).values(transaction_id=first.id))
        await session.delete(txn)
    if tombstones:
        flags["merged_external_ids"] = sorted(tombstones)
        first.flags = flags
    await session.commit()
    await session.refresh(first)
    return first


async def link_receipt(
    session: AsyncSession,
    user: User,
    statement_transaction_id: uuid.UUID,
    receipt_transaction_id: uuid.UUID | None,
    receipt_document_id: uuid.UUID | None,
) -> Transaction:
    statement = await get_transaction(session, user, statement_transaction_id)
    receipt = None
    if receipt_transaction_id:
        receipt = await get_transaction(session, user, receipt_transaction_id)
    elif receipt_document_id:
        receipt = (await session.execute(
            scoped_query(Transaction, user).where(Transaction.source_document_id == receipt_document_id)
        )).scalars().first()
    if receipt is None:
        raise NotFound("Receipt transaction not found")
    await _move_line_items_and_drop_receipt(session, statement, receipt)
    await session.commit()
    await session.refresh(statement)
    return statement


async def reconcile_receipt(session: AsyncSession, receipt_txn: Transaction, merchant: Merchant | None) -> Transaction:
    if merchant is None:
        return receipt_txn
    start = receipt_txn.txn_date - timedelta(days=3)
    end = receipt_txn.txn_date + timedelta(days=7)
    stmt = select(Transaction).where(
        Transaction.household_id == receipt_txn.household_id,
        Transaction.id != receipt_txn.id,
        Transaction.amount == receipt_txn.amount,
        Transaction.txn_date.between(start, end),
    )
    candidates = (await session.execute(stmt)).scalars().all()
    for candidate in candidates:
        cand_merchant = await session.get(Merchant, candidate.merchant_id) if candidate.merchant_id else None
        if cand_merchant and SequenceMatcher(None, merchant.canonical_name, cand_merchant.canonical_name).ratio() >= 0.72:
            await _move_line_items_and_drop_receipt(session, candidate, receipt_txn)
            return candidate
    return receipt_txn


async def _move_line_items_and_drop_receipt(session: AsyncSession, statement: Transaction, receipt: Transaction) -> None:
    await session.execute(update(LineItem).where(LineItem.transaction_id == receipt.id).values(transaction_id=statement.id))
    flags = dict(statement.flags or {})
    linked = list(flags.get("linked_receipt_document_ids", []))
    if receipt.source_document_id:
        linked.append(str(receipt.source_document_id))
    flags["linked_receipt_document_ids"] = sorted(set(linked))
    statement.flags = flags
    if statement.category_id is None:
        statement.category_id = receipt.category_id
    await session.delete(receipt)


_CADENCE_DAYS = (
    ("weekly", 7),
    ("biweekly", 14),
    ("monthly", 30),
    ("quarterly", 91),
    ("annual", 365),
)
_CADENCE_TOL = 0.35  # ±35% of the nominal gap
_CADENCE_INTERVAL = dict(_CADENCE_DAYS)


def infer_cadence(gap_days: float) -> str | None:
    for name, nominal in _CADENCE_DAYS:
        if abs(gap_days - nominal) <= nominal * _CADENCE_TOL:
            return name
    return None


async def detect_recurring(session: AsyncSession, txn: Transaction) -> None:
    if not txn.merchant_id:
        return
    since = txn.txn_date - timedelta(days=400)
    low = txn.amount * Decimal("0.95")
    high = txn.amount * Decimal("1.05")
    rows = list((await session.execute(select(Transaction).where(
        Transaction.household_id == txn.household_id,
        Transaction.merchant_id == txn.merchant_id,
        Transaction.amount >= min(low, high),
        Transaction.amount <= max(low, high),
        Transaction.txn_date >= since,
    ))).scalars().all())
    if len(rows) < 3:
        return
    dates = sorted(r.txn_date for r in rows)
    gaps = [(b - a).days for a, b in zip(dates, dates[1:]) if (b - a).days > 0]
    if not gaps:
        return
    cadence = infer_cadence(median(gaps))
    if cadence is None:
        return
    amounts = sorted(r.amount for r in rows)
    amount = amounts[len(amounts) // 2]  # median amount
    is_income = amount > 0  # canonical: money in is positive, money out negative
    series_type = "income" if is_income else (
        "subscription" if abs(amount) <= Decimal("50") else "bill"
    )
    next_due = dates[-1] + timedelta(days=_CADENCE_INTERVAL[cadence])

    merchant = await session.get(Merchant, txn.merchant_id)
    existing = (await session.execute(select(RecurringSeries).where(
        RecurringSeries.household_id == txn.household_id,
        RecurringSeries.merchant_id == txn.merchant_id,
        RecurringSeries.cadence == cadence,
    ))).scalar_one_or_none()
    if existing is None:
        existing = RecurringSeries(
            household_id=txn.household_id,
            owner_user_id=txn.owner_user_id,
            merchant_id=txn.merchant_id,
            category_id=txn.category_id,
            name=(merchant.canonical_name if merchant else "Recurring"),
            amount=abs(amount),
            currency=txn.currency,
            cadence=cadence,
            type=series_type,
            status="active",
            next_due_date=next_due,
            start_date=dates[0],
        )
        session.add(existing)
        await session.flush()
    else:
        existing.amount = abs(amount)
        existing.next_due_date = next_due
        existing.status = "active"
    txn.recurring_series_id = existing.id
    flags = dict(txn.flags or {})
    flags["recurring"] = True
    txn.flags = flags


async def remember_category_rule(
    session: AsyncSession, household_id: uuid.UUID, merchant: Merchant, category_id: uuid.UUID
) -> Rule:
    stmt = select(Rule).where(
        Rule.household_id == household_id,
        Rule.matcher == {"field": "merchant", "op": "eq", "value": merchant.canonical_name},
    )
    rule = (await session.execute(stmt)).scalar_one_or_none()
    if rule is None:
        rule = Rule(
            household_id=household_id,
            matcher={"field": "merchant", "op": "eq", "value": merchant.canonical_name},
            action={"set_category": str(category_id)},
            priority=1000,
            source="user",
        )
        session.add(rule)
    else:
        rule.action = {"set_category": str(category_id)}
        rule.priority = max(rule.priority, 1000)
    await session.flush()
    return rule


async def list_categories(session: AsyncSession, user: User) -> list[Category]:
    stmt = select(Category).where(or_(Category.household_id == user.household_id, Category.household_id.is_(None))).order_by(Category.kind, Category.name)
    return list((await session.execute(stmt)).scalars().all())


async def create_category(session: AsyncSession, user: User, data: CategoryIn) -> Category:
    # Categories created through the tenant API always belong to the caller's
    # household. Global system categories (household_id IS NULL, visible to every
    # household) are a seed/operator concern — letting a tenant mint them lets one
    # account pollute the category list of every other account.
    if data.parent_id is not None:
        await _validate_category_ref(session, user.household_id, data.parent_id)
    cat = Category(
        household_id=user.household_id,
        parent_id=data.parent_id,
        name=data.name,
        kind=data.kind,
        is_system=False,
    )
    session.add(cat)
    await session.commit()
    await session.refresh(cat)
    return cat


async def merge_category(session: AsyncSession, user: User, source_id: uuid.UUID, into_id: uuid.UUID) -> None:
    source = await session.get(Category, source_id)
    dest = await session.get(Category, into_id)
    # Both categories must be this household's OWN. System categories
    # (household_id IS NULL) are global; merging one would repoint every other
    # household's transactions at the caller's category — cross-tenant corruption.
    if (
        source is None
        or dest is None
        or source.household_id != user.household_id
        or dest.household_id != user.household_id
    ):
        raise NotFound("Category not found")
    hid = user.household_id
    # Every rewrite is household-scoped so it can only touch the caller's own rows.
    await session.execute(
        update(Transaction)
        .where(Transaction.category_id == source_id, Transaction.household_id == hid)
        .values(category_id=into_id)
    )
    household_txn_ids = select(Transaction.id).where(Transaction.household_id == hid)
    await session.execute(
        update(LineItem)
        .where(
            LineItem.item_type_category_id == source_id,
            LineItem.transaction_id.in_(household_txn_ids),
        )
        .values(item_type_category_id=into_id)
    )
    await session.execute(
        update(Merchant)
        .where(Merchant.default_category_id == source_id, Merchant.household_id == hid)
        .values(default_category_id=into_id)
    )
    await session.delete(source)
    await session.commit()


async def list_tags(session: AsyncSession, user: User) -> list[Tag]:
    return list((await session.execute(scoped_query(Tag, user).order_by(Tag.name))).scalars().all())


async def create_tag(session: AsyncSession, user: User, data: TagIn) -> Tag:
    tag = Tag(household_id=user.household_id, name=data.name)
    session.add(tag)
    await session.commit()
    await session.refresh(tag)
    return tag


async def list_rules(session: AsyncSession, user: User) -> list[Rule]:
    return list((await session.execute(scoped_query(Rule, user).order_by(Rule.priority.desc()))).scalars().all())


async def create_rule(session: AsyncSession, user: User, data: RuleIn) -> Rule:
    rule = Rule(household_id=user.household_id, matcher=data.matcher, action=data.action, priority=data.priority, source=data.source)
    session.add(rule)
    await session.commit()
    await session.refresh(rule)
    return rule


async def tag_transaction(session: AsyncSession, user: User, transaction_id: uuid.UUID, tag_id: uuid.UUID) -> None:
    await get_transaction(session, user, transaction_id)
    tag = await session.get(Tag, tag_id)
    if tag is None or tag.household_id != user.household_id:
        raise NotFound("Tag not found")
    session.add(TransactionTag(transaction_id=transaction_id, tag_id=tag_id))
    await session.commit()


async def delete_line_items_for_transaction(session: AsyncSession, transaction_id: uuid.UUID) -> None:
    item_ids = (await session.execute(select(LineItem.id).where(LineItem.transaction_id == transaction_id))).scalars().all()
    if item_ids:
        await session.execute(delete(LineItemTag).where(LineItemTag.line_item_id.in_(item_ids)))
    await session.execute(delete(LineItem).where(LineItem.transaction_id == transaction_id))
