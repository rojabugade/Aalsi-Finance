from __future__ import annotations

import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.analyst import service
from app.analyst.schemas import (
    AnalystAskIn,
    AnalystAskOut,
    AnalystThreadOut,
    DebtPlanOut,
    DebtPlanRequest,
    MemoryStatusOut,
    MonitorOut,
    PersistentAlert,
    ReindexOut,
)
from app.auth.deps import get_current_user
from app.beta.limits import enforce_ai_quota
from app.db import get_session
from app.llm.client import LLMClient, get_llm_client
from app.models.core import User

router = APIRouter(prefix="/analyst", tags=["analyst"])


@router.get("/monitor", response_model=MonitorOut)
async def monitor(
    from_date: date = Query(alias="from"),
    to_date: date = Query(alias="to"),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await service.run_monitor(session, user, from_date, to_date)


@router.get("/thread/{key}/messages", response_model=AnalystThreadOut)
async def thread_history(
    key: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    try:
        return await service.run_thread_history(session, user, key)
    except service.ReservedThreadKey as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/ask", response_model=AnalystAskOut, dependencies=[Depends(enforce_ai_quota)])
async def ask(
    data: AnalystAskIn,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    llm: LLMClient = Depends(get_llm_client),
):
    try:
        return await service.run_ask(session, user, data, llm)
    except service.ReservedThreadKey as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/alerts/{alert_id}/acknowledge", response_model=PersistentAlert)
async def acknowledge(
    alert_id: uuid.UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    result = await service.run_acknowledge(session, user, alert_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Alert not found")
    return result


@router.post("/scan", dependencies=[Depends(enforce_ai_quota)])
async def scan(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    llm: LLMClient = Depends(get_llm_client),
):
    return await service.run_scan_alerts(session, user, llm)


@router.get("/memory/status", response_model=MemoryStatusOut)
async def memory_status(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await service.memory_status(session, user)


@router.post("/reindex", response_model=ReindexOut, dependencies=[Depends(enforce_ai_quota)])
async def reindex(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    llm: LLMClient = Depends(get_llm_client),
):
    return await service.run_reindex(session, user, llm)


@router.post("/debt-plan", response_model=DebtPlanOut, dependencies=[Depends(enforce_ai_quota)])
async def debt_plan(
    data: DebtPlanRequest | None = None,
    force: bool = Query(False, description="Bypass the cache and recompute the plan fresh."),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    llm: LLMClient = Depends(get_llm_client),
):
    return await service.run_debt_plan(
        session, user, llm, force=force,
        aggression_level=data.aggression_level if data else None,
    )
