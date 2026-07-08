from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user, require_role
from app.db import get_session
from app.models.core import User
from app.widget_data import service
from app.widget_data.schemas import (
    CreditCardDetailIn,
    CreditCardOut,
    HoldingIn,
    HoldingOut,
    HoldingPatch,
    PaymentMethodIn,
    PaymentMethodOut,
    PaymentMethodPatch,
    RecurringSeriesIn,
    RecurringSeriesOut,
    RecurringSeriesPatch,
    ValuationIn,
    ValuationOut,
)

router = APIRouter(tags=["widget-data"])


def _translate(exc: Exception) -> None:
    if isinstance(exc, service.NotFound):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    if isinstance(exc, service.InvalidReference):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    raise exc


@router.get("/payment-methods", response_model=list[PaymentMethodOut])
async def payment_methods(user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    return await service.list_payment_methods(session, user)


@router.post("/payment-methods", response_model=PaymentMethodOut, status_code=status.HTTP_201_CREATED)
async def create_payment_method(data: PaymentMethodIn, user: User = Depends(require_role("owner", "member")), session: AsyncSession = Depends(get_session)):
    try:
        return await service.create_payment_method(session, user, data)
    except (service.NotFound, service.InvalidReference) as exc:
        _translate(exc)


@router.patch("/payment-methods/{method_id}", response_model=PaymentMethodOut)
async def patch_payment_method(method_id: uuid.UUID, data: PaymentMethodPatch, user: User = Depends(require_role("owner", "member")), session: AsyncSession = Depends(get_session)):
    try:
        return await service.patch_payment_method(session, user, method_id, data)
    except (service.NotFound, service.InvalidReference) as exc:
        _translate(exc)


@router.delete("/payment-methods/{method_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_payment_method(method_id: uuid.UUID, user: User = Depends(require_role("owner", "member")), session: AsyncSession = Depends(get_session)):
    try:
        await service.delete_payment_method(session, user, method_id)
    except service.NotFound as exc:
        _translate(exc)


@router.get("/credit-cards", response_model=list[CreditCardOut])
async def credit_cards(user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    return await service.list_credit_cards(session, user)


@router.put("/loans/{loan_id}/credit-card-detail", response_model=CreditCardOut)
async def put_credit_card_detail(loan_id: uuid.UUID, data: CreditCardDetailIn, user: User = Depends(require_role("owner", "member")), session: AsyncSession = Depends(get_session)):
    try:
        return await service.upsert_credit_card_detail(session, user, loan_id, data)
    except (service.NotFound, service.InvalidReference) as exc:
        _translate(exc)


@router.get("/recurring-series", response_model=list[RecurringSeriesOut])
async def recurring_series(status_filter: str | None = Query(default=None, alias="status"), user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    return await service.list_recurring(session, user, status_filter)


@router.post("/recurring-series", response_model=RecurringSeriesOut, status_code=status.HTTP_201_CREATED)
async def create_recurring_series(data: RecurringSeriesIn, user: User = Depends(require_role("owner", "member")), session: AsyncSession = Depends(get_session)):
    try:
        return await service.create_recurring(session, user, data)
    except (service.NotFound, service.InvalidReference) as exc:
        _translate(exc)


@router.patch("/recurring-series/{series_id}", response_model=RecurringSeriesOut)
async def patch_recurring_series(series_id: uuid.UUID, data: RecurringSeriesPatch, user: User = Depends(require_role("owner", "member")), session: AsyncSession = Depends(get_session)):
    try:
        return await service.patch_recurring(session, user, series_id, data)
    except (service.NotFound, service.InvalidReference) as exc:
        _translate(exc)


@router.delete("/recurring-series/{series_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_recurring_series(series_id: uuid.UUID, user: User = Depends(require_role("owner", "member")), session: AsyncSession = Depends(get_session)):
    try:
        await service.delete_recurring(session, user, series_id)
    except service.NotFound as exc:
        _translate(exc)


@router.get("/holdings", response_model=list[HoldingOut])
async def holdings(user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    return await service.list_holdings(session, user)


@router.post("/holdings", response_model=HoldingOut, status_code=status.HTTP_201_CREATED)
async def create_holding(data: HoldingIn, user: User = Depends(require_role("owner", "member")), session: AsyncSession = Depends(get_session)):
    try:
        return await service.create_holding(session, user, data)
    except (service.NotFound, service.InvalidReference) as exc:
        _translate(exc)


@router.patch("/holdings/{holding_id}", response_model=HoldingOut)
async def patch_holding(holding_id: uuid.UUID, data: HoldingPatch, user: User = Depends(require_role("owner", "member")), session: AsyncSession = Depends(get_session)):
    try:
        return await service.patch_holding(session, user, holding_id, data)
    except (service.NotFound, service.InvalidReference) as exc:
        _translate(exc)


@router.delete("/holdings/{holding_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_holding(holding_id: uuid.UUID, user: User = Depends(require_role("owner", "member")), session: AsyncSession = Depends(get_session)):
    try:
        await service.delete_holding(session, user, holding_id)
    except service.NotFound as exc:
        _translate(exc)


@router.get("/holdings/{holding_id}/valuations", response_model=list[ValuationOut])
async def valuations(holding_id: uuid.UUID, user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    try:
        return await service.list_valuations(session, user, holding_id)
    except service.NotFound as exc:
        _translate(exc)


@router.post("/holdings/{holding_id}/valuations", response_model=ValuationOut, status_code=status.HTTP_201_CREATED)
async def create_valuation(holding_id: uuid.UUID, data: ValuationIn, user: User = Depends(require_role("owner", "member")), session: AsyncSession = Depends(get_session)):
    try:
        return await service.add_valuation(session, user, holding_id, data)
    except service.NotFound as exc:
        _translate(exc)
