from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import require_role
from app.db import get_session
from app.fx import service
from app.fx.schemas import FXRateOut, FXRefreshOut
from app.models.core import User

router = APIRouter(prefix="/fx", tags=["fx"])


@router.get("/rates", response_model=FXRateOut)
async def get_rate(
    pair: str,
    rate_date: date = Query(..., alias="date"),
    session: AsyncSession = Depends(get_session),
) -> FXRateOut:
    try:
        normalized = service.normalize_pair(pair)
        rate, matched_date = await service.get_rate(session, normalized, rate_date)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    except service.FXRateUnavailable as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    return FXRateOut(pair=normalized, requested_date=rate_date, rate_date=matched_date, rate=rate)


@router.post("/refresh", response_model=FXRefreshOut, tags=["admin"])
async def refresh_rates(
    _user: User = Depends(require_role("owner")),
    session: AsyncSession = Depends(get_session),
) -> dict:
    return await service.refresh_used_rates(session)
