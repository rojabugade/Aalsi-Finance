"""Nightly gap-filling safety net. For each source type, index any row that has
no memory_chunk yet — so memory self-heals even if an on-write enqueue was
dropped. Reuses index_source for rendering; only the missing-id query lives here."""

from __future__ import annotations

import uuid

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.analyst.memory.ingest import index_source
from app.models.accounts import AccountBalance, AccountLogical, PaymentMethod
from app.models.debt import Loan
from app.models.documents import Document
from app.models.income import IncomeSource
from app.models.investments import HoldingValuation, InvestmentHolding
from app.models.memory import MemoryChunk
from app.models.transactions import Budget, Category, Merchant, RecurringSeries, Rule, Tag, Transaction

_MODELS = {
    "document": Document,
    "transaction": Transaction,
    "loan": Loan,
    "recurring": RecurringSeries,
    "account": AccountLogical,
    "account_balance": AccountBalance,
    "payment_method": PaymentMethod,
    "budget": Budget,
    "merchant": Merchant,
    "category": Category,
    "tag": Tag,
    "rule": Rule,
    "income_source": IncomeSource,
    "investment_holding": InvestmentHolding,
    "holding_valuation": HoldingValuation,
}


async def _missing_ids(session: AsyncSession, household_id: uuid.UUID, source_type: str) -> list[uuid.UUID]:
    model = _MODELS[source_type]
    indexed = (
        select(MemoryChunk.source_id)
        .where(MemoryChunk.household_id == household_id, MemoryChunk.source_type == source_type)
    )
    if source_type in {"merchant", "category"}:
        stmt = select(model.id).where(
            or_(model.household_id == household_id, model.household_id.is_(None)),
            model.id.not_in(indexed),
        )
    else:
        stmt = select(model.id).where(model.household_id == household_id, model.id.not_in(indexed))
    if source_type == "document":
        stmt = stmt.where(Document.private.is_(False), Document.extracted_text.is_not(None))
    if source_type == "transaction":
        stmt = stmt.where(Transaction.status == "confirmed")
    return list((await session.execute(stmt)).scalars().all())


async def reconcile_source(session: AsyncSession, household_id: uuid.UUID, source_type: str, llm) -> int:
    ids = await _missing_ids(session, household_id, source_type)
    if not ids:
        return 0
    return await index_source(session, household_id, source_type, ids, llm)


async def reconcile_household(session: AsyncSession, household_id: uuid.UUID, llm) -> dict[str, int]:
    return {
        source_type: await reconcile_source(session, household_id, source_type, llm)
        for source_type in _MODELS
    }
