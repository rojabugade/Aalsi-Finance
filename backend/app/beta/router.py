"""/beta endpoints: the public application form and the gate's current state."""

# NOTE: no `from __future__ import annotations` here, for the same reason as
# app/auth/router.py — the slowapi @limiter.limit wrapper carries its own module
# globals, so FastAPI cannot resolve stringized annotations on a rate-limited
# endpoint and would demote the request body to a query param (422).

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.beta import limits, service
from app.beta.schemas import (
    AllowanceOut,
    BetaApplicationIn,
    BetaApplicationOut,
    BetaStatusOut,
    BetaUsageOut,
)
from app.config import get_settings
from app.db import get_session
from app.models.core import User
from app.rate_limit import limiter

router = APIRouter(prefix="/beta", tags=["beta"])
settings = get_settings()


@router.post("/apply", response_model=BetaApplicationOut, status_code=status.HTTP_202_ACCEPTED)
@limiter.limit(settings.rate_limit_beta_apply)
async def apply(
    request: Request,
    data: BetaApplicationIn,
    session: AsyncSession = Depends(get_session),
) -> BetaApplicationOut:
    """Always 202, whether or not the address has applied before. See
    BetaApplicationOut on why the body carries nothing."""
    await service.record_application(session, data)
    return BetaApplicationOut()


@router.get("/status", response_model=BetaStatusOut)
async def beta_status() -> BetaStatusOut:
    """Lets the sign-up form require an invite code only while the gate is up,
    so opening the product to the public is a config flip, not a deploy."""
    return BetaStatusOut(invite_required=settings.beta_invite_required)


def _allowance_out(allowance: limits.Allowance) -> AllowanceOut:
    return AllowanceOut(
        used=allowance.used,
        limit=allowance.limit,
        remaining=allowance.remaining,
        next_credit_at=allowance.next_credit_at,
    )


@router.get("/usage", response_model=BetaUsageOut)
async def usage(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> BetaUsageOut:
    """What this account has left today. Read straight off the same functions
    that do the refusing — see app/beta/limits.py."""
    ai = await limits.ai_allowance(session, user.id)
    documents = await limits.document_allowance(session, user.household_id)
    return BetaUsageOut(
        active=ai.limit > 0 or documents.limit > 0,
        ai_requests=_allowance_out(ai),
        documents=_allowance_out(documents),
        ai_daily_cost_limit_usd=settings.llm_daily_cost_limit_usd,
        ai_requests_per_minute=settings.beta_limit_ai_requests_per_minute,
    )
