"""Thread/message persistence for the analyst: resolve a stable per-household
thread key to a row, append a user+analyst turn, and load recent turns (oldest
first) for prompt context. Tenant isolation via scoped_query on the thread."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import scoped_query
from app.models.conversation import AnalystMessage, AnalystThread
from app.models.core import User


async def get_or_create_thread(session: AsyncSession, user: User, key: str) -> AnalystThread:
    row = (await session.execute(
        scoped_query(AnalystThread, user).where(AnalystThread.key == key)
    )).scalar_one_or_none()
    if row is None:
        row = AnalystThread(household_id=user.household_id, key=key)
        session.add(row)
        await session.commit()
    return row


async def recent_turns(
    session: AsyncSession, thread_id: uuid.UUID, limit: int = 6
) -> list[AnalystMessage]:
    rows = (await session.execute(
        select(AnalystMessage)
        .where(AnalystMessage.thread_id == thread_id)
        .order_by(AnalystMessage.created_at.desc(), AnalystMessage.id.desc())
        .limit(limit)
    )).scalars().all()
    return list(reversed(rows))


async def append_turn(
    session: AsyncSession, thread_id: uuid.UUID, *, question: str, answer: str
) -> None:
    # Assign explicit timestamps so user < analyst ordering is stable even when
    # both rows share the same transaction's now() server value. The 1-µs offset
    # is enough for ORDER BY created_at DESC + reversal to preserve turn order.
    now = datetime.now(timezone.utc)
    session.add(AnalystMessage(thread_id=thread_id, role="user", text=question, created_at=now))
    session.add(AnalystMessage(thread_id=thread_id, role="analyst", text=answer, created_at=now + timedelta(microseconds=1)))
    await session.commit()
