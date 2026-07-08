"""Incremental memory ingestion: render + index the rows touched by a single
write, by id. Shared by the on-write Celery task (analyst.index_source) and the
nightly reconcile. Household-scoped by household_id (no User needed), so it runs
cleanly from a background worker."""

from __future__ import annotations

import uuid

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.analyst.memory import render
from app.analyst.memory.indexer import index_chunks
from app.models.accounts import AccountBalance, AccountLogical, PaymentMethod
from app.models.debt import Loan
from app.models.documents import Document
from app.models.income import IncomeSource
from app.models.investments import HoldingValuation, InvestmentHolding
from app.models.transactions import Category, Merchant, RecurringSeries, Transaction
from app.models.transactions import Budget, Rule, Tag


def _iso(value) -> str | None:
    return value.isoformat() if value is not None else None


async def _load_and_render(
    session: AsyncSession, household_id: uuid.UUID, source_type: str, source_ids: list[uuid.UUID]
) -> list[tuple[uuid.UUID, str, dict]]:
    if not source_ids:
        return []
    if source_type == "transaction":
        rows = list((await session.execute(
            select(Transaction).where(
                Transaction.household_id == household_id, Transaction.id.in_(source_ids)
            )
        )).scalars().all())
        merchant_ids = {r.merchant_id for r in rows if r.merchant_id}
        category_ids = {r.category_id for r in rows if r.category_id}
        merchants = {
            m.id: m.canonical_name for m in (await session.execute(
                select(Merchant).where(Merchant.id.in_(merchant_ids)))).scalars().all()
        } if merchant_ids else {}
        cats = {
            c.id: c.name for c in (await session.execute(
                select(Category).where(Category.id.in_(category_ids)))).scalars().all()
        } if category_ids else {}
        return [
            (r.id,
             render.render_transaction(r, merchant=merchants.get(r.merchant_id), category=cats.get(r.category_id)),
             {"date": _iso(r.txn_date)})
            for r in rows
        ]
    if source_type == "loan":
        rows = list((await session.execute(
            select(Loan).where(Loan.household_id == household_id, Loan.id.in_(source_ids)))).scalars().all())
        return [(r.id, render.render_loan(r), {"date": _iso(r.start_date)}) for r in rows]
    if source_type == "recurring":
        rows = list((await session.execute(
            select(RecurringSeries).where(
                RecurringSeries.household_id == household_id, RecurringSeries.id.in_(source_ids)
            ))).scalars().all())
        return [(r.id, render.render_recurring(r), {"date": _iso(r.next_due_date)}) for r in rows]
    if source_type == "account":
        rows = list((await session.execute(
            select(AccountLogical).where(
                AccountLogical.household_id == household_id, AccountLogical.id.in_(source_ids)
            ))).scalars().all())
        return [(r.id, render.render_account(r), {}) for r in rows]
    if source_type == "account_balance":
        rows = list((await session.execute(
            select(AccountBalance).where(
                AccountBalance.household_id == household_id, AccountBalance.id.in_(source_ids)
            ))).scalars().all())
        account_ids = {r.account_id for r in rows}
        accounts = {
            a.id: a for a in (await session.execute(
                select(AccountLogical).where(AccountLogical.id.in_(account_ids)))).scalars().all()
        } if account_ids else {}
        return [
            (r.id, render.render_account_balance(
                r,
                account_label=getattr(accounts.get(r.account_id), "label", None),
                account_type=getattr(accounts.get(r.account_id), "type", None),
            ), {"date": _iso(r.as_of)})
            for r in rows
        ]
    if source_type == "payment_method":
        rows = list((await session.execute(
            select(PaymentMethod).where(
                PaymentMethod.household_id == household_id, PaymentMethod.id.in_(source_ids)
            ))).scalars().all())
        account_ids = {r.account_id for r in rows if r.account_id}
        accounts = {
            a.id: a.label for a in (await session.execute(
                select(AccountLogical).where(AccountLogical.id.in_(account_ids)))).scalars().all()
        } if account_ids else {}
        return [
            (r.id, render.render_payment_method(r, account_label=accounts.get(r.account_id)), {})
            for r in rows
        ]
    if source_type == "budget":
        rows = list((await session.execute(
            select(Budget).where(Budget.household_id == household_id, Budget.id.in_(source_ids))
        )).scalars().all())
        category_ids = {r.category_id for r in rows if r.category_id}
        cats = {
            c.id: c.name for c in (await session.execute(
                select(Category).where(Category.id.in_(category_ids)))).scalars().all()
        } if category_ids else {}
        return [(r.id, render.render_budget(r, category=cats.get(r.category_id)), {}) for r in rows]
    if source_type == "merchant":
        rows = list((await session.execute(
            select(Merchant).where(
                Merchant.id.in_(source_ids),
                or_(Merchant.household_id == household_id, Merchant.household_id.is_(None)),
            ))).scalars().all())
        category_ids = {r.default_category_id for r in rows if r.default_category_id}
        cats = {
            c.id: c.name for c in (await session.execute(
                select(Category).where(Category.id.in_(category_ids)))).scalars().all()
        } if category_ids else {}
        return [(r.id, render.render_merchant(r, default_category=cats.get(r.default_category_id)), {}) for r in rows]
    if source_type == "category":
        rows = list((await session.execute(
            select(Category).where(
                Category.id.in_(source_ids),
                or_(Category.household_id == household_id, Category.household_id.is_(None)),
            ))).scalars().all())
        parent_ids = {r.parent_id for r in rows if r.parent_id}
        parents = {
            c.id: c.name for c in (await session.execute(
                select(Category).where(Category.id.in_(parent_ids)))).scalars().all()
        } if parent_ids else {}
        return [(r.id, render.render_category(r, parent=parents.get(r.parent_id)), {}) for r in rows]
    if source_type == "tag":
        rows = list((await session.execute(
            select(Tag).where(Tag.household_id == household_id, Tag.id.in_(source_ids))
        )).scalars().all())
        return [(r.id, render.render_tag(r), {}) for r in rows]
    if source_type == "rule":
        rows = list((await session.execute(
            select(Rule).where(Rule.household_id == household_id, Rule.id.in_(source_ids))
        )).scalars().all())
        return [(r.id, render.render_rule(r), {}) for r in rows]
    if source_type == "income_source":
        rows = list((await session.execute(
            select(IncomeSource).where(
                IncomeSource.household_id == household_id, IncomeSource.id.in_(source_ids)
            ))).scalars().all())
        return [(r.id, render.render_income_source(r), {}) for r in rows]
    if source_type == "investment_holding":
        rows = list((await session.execute(
            select(InvestmentHolding).where(
                InvestmentHolding.household_id == household_id, InvestmentHolding.id.in_(source_ids)
            ))).scalars().all())
        account_ids = {r.account_id for r in rows}
        accounts = {
            a.id: a.label for a in (await session.execute(
                select(AccountLogical).where(AccountLogical.id.in_(account_ids)))).scalars().all()
        } if account_ids else {}
        return [
            (r.id, render.render_investment_holding(r, account_label=accounts.get(r.account_id)), {})
            for r in rows
        ]
    if source_type == "holding_valuation":
        rows = list((await session.execute(
            select(HoldingValuation).where(
                HoldingValuation.household_id == household_id, HoldingValuation.id.in_(source_ids)
            ))).scalars().all())
        holding_ids = {r.holding_id for r in rows}
        holdings = {
            h.id: h.name for h in (await session.execute(
                select(InvestmentHolding).where(InvestmentHolding.id.in_(holding_ids)))).scalars().all()
        } if holding_ids else {}
        return [
            (r.id, render.render_holding_valuation(r, holding_name=holdings.get(r.holding_id)), {"date": _iso(r.as_of)})
            for r in rows
        ]
    if source_type == "document":
        rows = list((await session.execute(
            select(Document).where(
                Document.household_id == household_id,
                Document.id.in_(source_ids),
                Document.private.is_(False),
                Document.extracted_text.is_not(None),
            )
        )).scalars().all())
        items = []
        for row in rows:
            prefix = f"Document ({row.type}, {row.domain or 'unknown domain'}): "
            for chunk in render.chunk_text(row.extracted_text or ""):
                items.append((row.id, prefix + chunk, {"domain": row.domain, "type": row.type}))
        return items
    return []


async def index_source(
    session: AsyncSession, household_id: uuid.UUID, source_type: str,
    source_ids: list[uuid.UUID], llm,
) -> int:
    items = await _load_and_render(session, household_id, source_type, source_ids)
    if not items:
        return 0
    pairs = [(sid, txt) for sid, txt, _ in items]
    metas = [meta for _, _, meta in items]
    return await index_chunks(session, household_id, source_type, pairs, llm, metas=metas)


def enqueue_index_source(household_id, source_type: str, source_ids) -> None:
    """Best-effort fire-and-forget. A dead broker must never break the write."""
    ids = [str(s) for s in source_ids if s is not None]
    if not ids:
        return
    try:
        from app.tasks.analyst import index_source_task
        index_source_task.delay(str(household_id), source_type, ids)
    except Exception:
        pass
