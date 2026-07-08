from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user, require_role
from app.db import get_session
from app.income import service
from app.income.schemas import (
    EquityEventIn,
    EquityEventOut,
    EquityGrantIn,
    EquityGrantOut,
    EquitySummaryOut,
    IncomeSourceIn,
    IncomeSourceOut,
    IncomeSourcePatch,
    PaystubIn,
    PaystubOut,
    TakeHomeOut,
)
from app.models.core import User

router = APIRouter(tags=["income"])


def _not_found(exc: service.NotFound):
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


@router.get("/income-sources", response_model=list[IncomeSourceOut])
async def list_income_sources(user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    return await service.list_income_sources(session, user)


@router.post("/income-sources", response_model=IncomeSourceOut, status_code=status.HTTP_201_CREATED)
async def create_income_source(data: IncomeSourceIn, user: User = Depends(require_role("owner", "member")), session: AsyncSession = Depends(get_session)):
    return await service.create_income_source(session, user, data)


@router.patch("/income-sources/{source_id}", response_model=IncomeSourceOut)
async def patch_income_source(source_id: uuid.UUID, data: IncomeSourcePatch, user: User = Depends(require_role("owner", "member")), session: AsyncSession = Depends(get_session)):
    try:
        return await service.patch_income_source(session, user, source_id, data)
    except service.NotFound as exc:
        _not_found(exc)


@router.post("/paystubs", response_model=PaystubOut, status_code=status.HTTP_201_CREATED)
async def create_paystub(data: PaystubIn, user: User = Depends(require_role("owner", "member")), session: AsyncSession = Depends(get_session)):
    try:
        return await service.create_paystub(session, user, data)
    except service.NotFound as exc:
        _not_found(exc)


@router.get("/income/take-home", response_model=TakeHomeOut)
async def take_home(source_id: uuid.UUID, user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    try:
        return await service.take_home_estimate(session, user, source_id)
    except service.NotFound as exc:
        _not_found(exc)


@router.get("/equity/grants", response_model=list[EquityGrantOut])
async def list_equity_grants(user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    return await service.list_equity_grants(session, user)


@router.post("/equity/grants", response_model=EquityGrantOut, status_code=status.HTTP_201_CREATED)
async def create_equity_grant(data: EquityGrantIn, user: User = Depends(require_role("owner", "member")), session: AsyncSession = Depends(get_session)):
    try:
        return await service.create_equity_grant(session, user, data)
    except service.NotFound as exc:
        _not_found(exc)


@router.get("/equity/events", response_model=list[EquityEventOut])
async def list_equity_events(user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    return await service.list_equity_events(session, user)


@router.post("/equity/events", response_model=EquityEventOut, status_code=status.HTTP_201_CREATED)
async def create_equity_event(data: EquityEventIn, user: User = Depends(require_role("owner", "member")), session: AsyncSession = Depends(get_session)):
    try:
        return await service.create_equity_event(session, user, data)
    except service.NotFound as exc:
        _not_found(exc)


@router.get("/equity/summary", response_model=EquitySummaryOut)
async def equity_summary(user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    return await service.equity_summary(session, user)
