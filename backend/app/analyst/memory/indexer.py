"""Embed rendered source text and upsert it into memory_chunk. Idempotent per
(source_type, source_id): re-indexing a row replaces its prior chunks."""

from __future__ import annotations

import uuid

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.analyst.memory import render  # noqa: F401 — resolves package; renderers used by Task 5
from app.llm.errors import LLMError
from app.models.memory import MemoryChunk


async def index_chunks(
    session: AsyncSession,
    household_id: uuid.UUID,
    source_type: str,
    items: list[tuple[uuid.UUID, str]],
    llm,
    *,
    metas: list[dict | None] | None = None,
) -> int:
    """Embed *items* and upsert into memory_chunk. Idempotent per (source_type, source_id).

    Args:
        session:       SQLAlchemy async session (caller owns the lifecycle).
        household_id:  Household owning these chunks.
        source_type:   E.g. "transaction", "loan", "document".
        items:         List of (source_id, rendered_text) pairs.
        llm:           LLM gateway (or _FakeLLM in tests); must expose
                       ``async embed(texts, **kw) -> list[list[float]]``.

    Returns:
        Number of chunks inserted (== len(items)).
    """
    if not items:
        return 0

    source_ids = [sid for sid, _ in items]
    await session.execute(
        delete(MemoryChunk).where(
            MemoryChunk.household_id == household_id,
            MemoryChunk.source_type == source_type,
            MemoryChunk.source_id.in_(source_ids),
        )
    )

    texts = [t for _, t in items]
    try:
        vectors = await llm.embed(texts, purpose="analyst.index", session=session)
    except LLMError:
        vectors = [None] * len(texts)  # store unembedded; a later reindex fills them

    metas = metas if metas is not None else [None] * len(items)
    for (sid, txt), vec, meta in zip(items, vectors, metas):
        session.add(
            MemoryChunk(
                household_id=household_id,
                source_type=source_type,
                source_id=sid,
                text=txt,
                embedding=vec,
                meta=meta,
            )
        )
    await session.commit()
    return len(items)
