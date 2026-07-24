from __future__ import annotations

import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.analytics import service
from app.analytics.schemas import (
    AnalyticsSummaryOut,
    BreakdownOut,
    BudgetIn,
    BudgetOut,
    BudgetPatch,
    NetWorthOut,
    RecommendationOut,
    TimeSeriesOut,
)
from app.auth.deps import get_current_user
from app.db import get_session
from app.models.core import User

router = APIRouter(tags=["analytics"])


def _not_found(exc: service.NotFound):
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


@router.get("/analytics/summary", response_model=AnalyticsSummaryOut)
async def analytics_summary(
    request: Request,
    from_date: date = Query(alias="from"),
    to_date: date = Query(alias="to"),
    group_by: list[str] = Query(default_factory=list),
    compare: str | None = None,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AnalyticsSummaryOut:
    group_by = group_by or request.query_params.getlist("group_by[]")
    return await service.summary(session, user, from_date, to_date, group_by, compare)


@router.get("/analytics/timeseries", response_model=TimeSeriesOut)
async def analytics_timeseries(
    metric: str = "spend",
    interval: str = "monthly",
    from_date: date = Query(alias="from"),
    to_date: date = Query(alias="to"),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> TimeSeriesOut:
    return await service.timeseries(session, user, metric, interval, from_date, to_date)


@router.get("/analytics/breakdown", response_model=BreakdownOut)
async def analytics_breakdown(
    dimension: str,
    filter: str | None = None,
    from_date: date = Query(alias="from"),
    to_date: date = Query(alias="to"),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> BreakdownOut:
    return await service.breakdown(session, user, dimension, filter, from_date, to_date)


@router.get("/analytics/net-worth", response_model=NetWorthOut)
async def analytics_net_worth(
    from_date: date | None = Query(default=None, alias="from"),
    to_date: date | None = Query(default=None, alias="to"),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> NetWorthOut:
    end = to_date or date.today()
    start = from_date
    if start is None:
        # Default window: trailing 6 months including the current month.
        year, month = end.year, end.month - 5
        while month <= 0:
            month += 12
            year -= 1
        start = date(year, month, 1)
    return await service.net_worth(session, user, start, end)


@router.get("/budgets", response_model=list[BudgetOut], tags=["budgets"])
async def list_budgets(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[BudgetOut]:
    return await service.list_budgets(session, user)


@router.post("/budgets", response_model=BudgetOut, status_code=status.HTTP_201_CREATED, tags=["budgets"])
async def create_budget(
    data: BudgetIn,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> BudgetOut:
    try:
        return await service.create_budget(session, user, data)
    except service.NotFound as exc:
        _not_found(exc)


@router.patch("/budgets/{budget_id}", response_model=BudgetOut, tags=["budgets"])
async def update_budget(
    budget_id: uuid.UUID,
    data: BudgetPatch,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> BudgetOut:
    try:
        return await service.update_budget(session, user, budget_id, data)
    except service.NotFound as exc:
        _not_found(exc)


@router.delete("/budgets/{budget_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["budgets"])
async def delete_budget(
    budget_id: uuid.UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    try:
        await service.delete_budget(session, user, budget_id)
    except service.NotFound as exc:
        _not_found(exc)


@router.get("/recommendations", response_model=list[RecommendationOut], tags=["recommendations"])
async def list_recommendations(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[RecommendationOut]:
    return await service.recommendations(session, user)


@router.post("/recommendations/{recommendation_id}/dismiss", status_code=status.HTTP_204_NO_CONTENT, tags=["recommendations"])
async def dismiss_recommendation(
    recommendation_id: uuid.UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    try:
        await service.dismiss_recommendation(session, user, recommendation_id)
    except service.NotFound as exc:
        _not_found(exc)
