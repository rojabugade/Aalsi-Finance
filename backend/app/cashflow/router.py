from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.cashflow import service
from app.cashflow.schemas import CashflowSummary
from app.db import get_session
from app.models.core import User

router = APIRouter(tags=["cashflow"])


@router.get("/cashflow/summary", response_model=CashflowSummary)
async def cashflow_summary(
    months: int = Query(6, ge=1, le=24),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await service.build_cashflow_summary(session, user, months=months)
