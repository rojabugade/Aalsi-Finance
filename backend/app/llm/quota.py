"""Per-user LLM spend cap.

Without this, one account can drive unbounded spend on the deployment's own API
key: the analyst chats, vision OCR runs on every uploaded page, and nothing stops
a loop. `llm_usage_log.cost_est` was already being recorded — this reads it back
and enforces a rolling daily and monthly ceiling.

The cap is deliberately advisory-by-configuration: `llm_daily_cost_limit_usd` of 0
disables it, which is the right default for a single-user self-hosted install and
the wrong one for a public signup page.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import structlog
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.llm.errors import LLMQuotaExceeded
from app.models.core import LLMUsageLog

log = structlog.get_logger()


async def _spend_since(
    session: AsyncSession, user_id: uuid.UUID, since: datetime
) -> Decimal:
    total = await session.scalar(
        select(func.coalesce(func.sum(LLMUsageLog.cost_est), 0)).where(
            LLMUsageLog.user_id == user_id,
            LLMUsageLog.created_at >= since,
        )
    )
    return Decimal(str(total or 0))


async def check_quota(
    session: AsyncSession | None, user_id: uuid.UUID | None
) -> None:
    """Raise LLMQuotaExceeded when the user is over their allowance.

    A missing session or user means the call is not attributable — background
    sweeps, for instance — and is left uncapped rather than blocked.
    """
    settings = get_settings()
    daily_limit = Decimal(str(settings.llm_daily_cost_limit_usd))
    monthly_limit = Decimal(str(settings.llm_monthly_cost_limit_usd))
    if session is None or user_id is None:
        return
    if daily_limit <= 0 and monthly_limit <= 0:
        return

    now = datetime.now(timezone.utc)

    if daily_limit > 0:
        spent = await _spend_since(session, user_id, now - timedelta(days=1))
        if spent >= daily_limit:
            log.warning(
                "llm.quota_exceeded", user_id=str(user_id), window="daily", spent=str(spent)
            )
            raise LLMQuotaExceeded(
                "Daily AI usage limit reached. It resets on a rolling 24-hour window."
            )

    if monthly_limit > 0:
        spent = await _spend_since(session, user_id, now - timedelta(days=30))
        if spent >= monthly_limit:
            log.warning(
                "llm.quota_exceeded", user_id=str(user_id), window="monthly", spent=str(spent)
            )
            raise LLMQuotaExceeded(
                "Monthly AI usage limit reached. It resets on a rolling 30-day window."
            )
