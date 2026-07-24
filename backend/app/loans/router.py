from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.db import get_session
from app.loans import service
from app.loans.schemas import (
    LoanIn,
    LoanOut,
    LoanPatch,
    LoanPaymentIn,
    LoanPaymentListOut,
    LoanPaymentOut,
    PaymentScheduleOut,
    PayoffCalcIn,
    PayoffCalcOut,
    PayoffStrategyIn,
    PayoffStrategyOut,
)
from app.models.core import User

router = APIRouter(tags=["loans"])


def _not_found(exc: service.NotFound):
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


@router.get("/loans", response_model=list[LoanOut])
async def list_loans(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[LoanOut]:
    return await service.list_loans(session, user)


@router.post("/loans", response_model=LoanOut, status_code=status.HTTP_201_CREATED)
async def create_loan(
    data: LoanIn,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> LoanOut:
    return await service.create_loan(session, user, data)


@router.patch("/loans/{loan_id}", response_model=LoanOut)
async def patch_loan(
    loan_id: uuid.UUID,
    data: LoanPatch,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> LoanOut:
    try:
        return await service.patch_loan(session, user, loan_id, data)
    except service.NotFound as exc:
        _not_found(exc)


@router.delete("/loans/{loan_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_loan(
    loan_id: uuid.UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    try:
        await service.delete_loan(session, user, loan_id)
    except service.NotFound as exc:
        _not_found(exc)


@router.get("/loans/{loan_id}/schedule", response_model=list[PaymentScheduleOut])
async def loan_schedule(
    loan_id: uuid.UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[PaymentScheduleOut]:
    try:
        return await service.schedule(session, user, loan_id)
    except service.NotFound as exc:
        _not_found(exc)


@router.get("/loans/{loan_id}/payments", response_model=LoanPaymentListOut)
async def list_loan_payments(
    loan_id: uuid.UUID,
    limit: int = 12,
    offset: int = 0,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> LoanPaymentListOut:
    try:
        return await service.list_payments(session, user, loan_id, limit=limit, offset=offset)
    except service.NotFound as exc:
        _not_found(exc)


@router.post(
    "/loans/{loan_id}/payments",
    response_model=LoanPaymentOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_loan_payment(
    loan_id: uuid.UUID,
    data: LoanPaymentIn,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> LoanPaymentOut:
    try:
        return await service.record_payment(session, user, loan_id, data)
    except service.NotFound as exc:
        _not_found(exc)


@router.delete(
    "/loans/{loan_id}/payments/{payment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_loan_payment(
    loan_id: uuid.UUID,
    payment_id: uuid.UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    try:
        await service.delete_payment(session, user, loan_id, payment_id)
    except service.NotFound as exc:
        _not_found(exc)


@router.post("/loans/{loan_id}/payoff-calc", response_model=PayoffCalcOut)
async def loan_payoff_calc(
    loan_id: uuid.UUID,
    data: PayoffCalcIn,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> PayoffCalcOut:
    try:
        return await service.payoff_calc(session, user, loan_id, data)
    except service.NotFound as exc:
        _not_found(exc)


@router.post("/loans/payoff-strategy", response_model=PayoffStrategyOut)
async def loan_payoff_strategy(
    data: PayoffStrategyIn,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> PayoffStrategyOut:
    return await service.payoff_strategy(session, user, data)
