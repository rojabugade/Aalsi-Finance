"""Per-user ceilings on the endpoints that cost real money.

Beta accounts get the whole product — every feature, no crippled tier. What they
get bounded is volume, because three paths spend the deployment's money rather
than the user's: LLM calls (analyst, guidance, categorisation), vision OCR over
uploaded pages, and the storage behind those uploads.

Two layers, deliberately:

- `app.llm.quota` caps *dollars* against `llm_usage_log.cost_est`. That is the
  ceiling that matters, and it is enforced inside the LLM client, so nothing can
  route around it.
- This module caps *requests*, which is what stops a cheap model being called
  ten thousand times, and gives a person a comprehensible number ("40 a day")
  instead of a dollar figure they have no way to reason about.

Enforcement and the `/beta/usage` display both go through `allowance()`, so the
number someone reads in Settings is computed by the same query that refuses
them. Two implementations of "how much is left" would drift, and the moment they
did, the UI would be lying at exactly the point it matters.

Both count completed work, so a burst of genuinely simultaneous requests can
overshoot by the size of the burst before the next one is refused. That is
acceptable at invite-only scale and bounded by the spend cap; it would not be at
open-signup scale, where these want to become Redis counters incremented before
the call rather than rows counted after it.

Every limit is disabled by setting it to 0, which is how this module retires
when the beta ends.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import structlog
from fastapi import Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.config import get_settings
from app.db import get_session
from app.models.core import LLMUsageLog, User
from app.models.documents import Document

log = structlog.get_logger()

WINDOW = timedelta(days=1)


@dataclass(frozen=True)
class Allowance:
    used: int
    limit: int
    # When the oldest counted event falls out of the rolling window — i.e. when
    # one more request becomes available. A rolling window has no midnight
    # reset, so this is the only honest answer to "when can I use it again?".
    next_credit_at: datetime | None

    @property
    def remaining(self) -> int:
        return max(0, self.limit - self.used)

    @property
    def exhausted(self) -> bool:
        return self.limit > 0 and self.used >= self.limit


async def _allowance(
    session: AsyncSession, model, owner_column, owner_id: uuid.UUID, limit: int
) -> Allowance:
    if limit <= 0:
        return Allowance(used=0, limit=0, next_credit_at=None)

    since = datetime.now(timezone.utc) - WINDOW
    row = (
        await session.execute(
            select(func.count(), func.min(model.created_at)).where(
                owner_column == owner_id, model.created_at >= since
            )
        )
    ).one()
    used, oldest = int(row[0] or 0), row[1]
    return Allowance(
        used=used,
        limit=limit,
        next_credit_at=(oldest + WINDOW) if oldest is not None else None,
    )


async def ai_allowance(session: AsyncSession, user_id: uuid.UUID) -> Allowance:
    """Counts `llm_usage_log` rows, which means a cache hit costs nothing
    against the quota — correct, since it costs nothing against the bill."""
    return await _allowance(
        session,
        LLMUsageLog,
        LLMUsageLog.user_id,
        user_id,
        get_settings().beta_limit_ai_requests_per_day,
    )


async def document_allowance(session: AsyncSession, household_id: uuid.UUID) -> Allowance:
    """Scoped to the household rather than the user because the cost is, and
    because that is the boundary every other query in the app uses."""
    return await _allowance(
        session,
        Document,
        Document.household_id,
        household_id,
        get_settings().beta_limit_documents_per_day,
    )


def _refuse(message: str) -> HTTPException:
    return HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, message)


async def enforce_ai_quota(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    per_minute = get_settings().beta_limit_ai_requests_per_minute
    if per_minute > 0:
        recent = int(
            await session.scalar(
                select(func.count()).select_from(LLMUsageLog).where(
                    LLMUsageLog.user_id == user.id,
                    LLMUsageLog.created_at >= datetime.now(timezone.utc) - timedelta(minutes=1),
                )
            )
            or 0
        )
        if recent >= per_minute:
            raise _refuse("Too many AI requests just now. Give it a minute.")

    allowance = await ai_allowance(session, user.id)
    if allowance.exhausted:
        log.warning("beta.ai_quota_exceeded", user_id=str(user.id), used=allowance.used)
        raise _refuse(
            f"You've used all {allowance.limit} AI requests for today. "
            "The allowance rolls forward over 24 hours."
        )


async def enforce_document_quota(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    allowance = await document_allowance(session, user.household_id)
    if allowance.exhausted:
        log.warning("beta.document_quota_exceeded", household_id=str(user.household_id))
        raise _refuse(
            f"You've uploaded all {allowance.limit} documents allowed today. "
            "The allowance rolls forward over 24 hours."
        )
