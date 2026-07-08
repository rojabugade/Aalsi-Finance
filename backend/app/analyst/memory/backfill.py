"""Render and index existing structured rows (transactions to start) into
memory_chunk. Entry point for manual reindex and the scheduled job (W2)."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.analyst.memory import render
from app.analyst.memory.indexer import index_chunks
from app.auth.deps import scoped_query
from app.models.core import User
from app.models.transactions import Category, Merchant, Transaction


async def backfill_transactions(session: AsyncSession, user: User, llm, limit: int = 500) -> int:
    stmt = scoped_query(Transaction, user).where(Transaction.status == "confirmed").limit(limit)
    txns = list((await session.execute(stmt)).scalars().all())
    if not txns:
        return 0
    merchants = {m.id: m.canonical_name for m in (await session.execute(scoped_query(Merchant, user))).scalars().all()}
    cats = {c.id: c.name for c in (await session.execute(scoped_query(Category, user))).scalars().all()}
    items = [
        (t.id, render.render_transaction(t, merchant=merchants.get(t.merchant_id), category=cats.get(t.category_id)))
        for t in txns
    ]
    return await index_chunks(session, user.household_id, "transaction", items, llm)
