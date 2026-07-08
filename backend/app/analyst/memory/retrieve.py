# backend/app/analyst/memory/retrieve.py
"""Semantic retrieval over memory_chunk (L2 distance, mirroring M10 guidance)
plus the active learned facts for a household."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import scoped_query
from app.llm.errors import LLMError
from app.models.core import User
from app.models.memory import MemoryChunk, MemoryFact


async def retrieve_chunks(session: AsyncSession, user: User, query: str, llm, limit: int = 8) -> list[MemoryChunk]:
    try:
        query_vec = (await llm.embed(query, purpose="analyst.retrieve", user_id=user.id, session=session))[0]
    except (LLMError, IndexError, Exception):  # retrieval is best-effort
        return []
    stmt = (
        scoped_query(MemoryChunk, user)
        .where(MemoryChunk.embedding.is_not(None))
        .order_by(MemoryChunk.embedding.l2_distance(query_vec))
        .limit(limit)
    )
    return list((await session.execute(stmt)).scalars().all())


async def recent_transaction_chunks(session: AsyncSession, user: User, limit: int = 5) -> list[MemoryChunk]:
    """Newest transaction chunks by their stored source date, independent of any
    semantic match — so 'recent transactions' returns actually-recent rows."""
    date_text = MemoryChunk.meta["date"].astext
    stmt = (
        scoped_query(MemoryChunk, user)
        .where(MemoryChunk.source_type == "transaction", date_text.is_not(None))
        .order_by(date_text.desc())
        .limit(limit)
    )
    return list((await session.execute(stmt)).scalars().all())


async def active_facts(session: AsyncSession, user: User, limit: int = 20) -> list[MemoryFact]:
    stmt = (
        scoped_query(MemoryFact, user)
        .where(MemoryFact.status == "active")
        .order_by(MemoryFact.updated_at.desc())
        .limit(limit)
    )
    return list((await session.execute(stmt)).scalars().all())
