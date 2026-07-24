from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class LoanIn(BaseModel):
    name: str
    type: str = "other"
    schedule_kind: str = "amortizing"
    principal: Decimal
    currency: str = "USD"
    interest_rate: Decimal | None = None
    compounding: str | None = "monthly"
    min_or_emi_amount: Decimal | None = None
    promo_rate: Decimal | None = None
    promo_expiry_date: date | None = None
    due_day: int | None = Field(default=None, ge=1, le=31)
    penalty_rules: dict | None = None
    start_date: date | None = None
    end_date: date | None = None


class LoanPatch(BaseModel):
    name: str | None = None
    type: str | None = None
    schedule_kind: str | None = None
    principal: Decimal | None = None
    currency: str | None = None
    interest_rate: Decimal | None = None
    compounding: str | None = None
    min_or_emi_amount: Decimal | None = None
    promo_rate: Decimal | None = None
    promo_expiry_date: date | None = None
    due_day: int | None = Field(default=None, ge=1, le=31)
    penalty_rules: dict | None = None
    start_date: date | None = None
    end_date: date | None = None


class CreditCardDetailOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    credit_limit: Decimal
    statement_balance: Decimal | None = None
    available_credit: Decimal | None = None
    statement_day: int | None = None
    utilization: float | None = None


class LoanOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    owner_user_id: uuid.UUID | None = None
    name: str
    type: str
    schedule_kind: str
    principal: Decimal
    currency: str
    interest_rate: Decimal | None = None
    compounding: str | None = None
    min_or_emi_amount: Decimal | None = None
    promo_rate: Decimal | None = None
    promo_expiry_date: date | None = None
    due_day: int | None = None
    penalty_rules: dict | None = None
    start_date: date | None = None
    end_date: date | None = None
    next_due_date: date | None = None
    penalty_warning: str | None = None
    base_currency: str | None = None
    base_principal: Decimal | None = None
    base_min_or_emi_amount: Decimal | None = None
    outstanding_balance: Decimal | None = None
    total_paid: Decimal | None = None
    total_principal_paid: Decimal | None = None
    total_interest_paid: Decimal | None = None
    progress_pct: float | None = None
    credit_card_detail: CreditCardDetailOut | None = None


class PaymentScheduleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    loan_id: uuid.UUID
    installment_no: int
    due_date: date
    principal_component: Decimal | None = None
    interest_component: Decimal | None = None
    balance_after: Decimal | None = None
    status: str


class ExtraPaymentIn(BaseModel):
    payment_date: date
    amount: Decimal


class PayoffCalcIn(BaseModel):
    monthly_payment: Decimal
    extra_payments: list[ExtraPaymentIn] = Field(default_factory=list)


class PayoffProjectionPoint(BaseModel):
    installment_no: int
    due_date: date
    payment: Decimal
    principal_component: Decimal
    interest_component: Decimal
    balance_after: Decimal


class PayoffCalcOut(BaseModel):
    loan_id: uuid.UUID
    months: int
    total_interest: Decimal
    total_paid: Decimal
    projection: list[PayoffProjectionPoint]
    warning: str | None = None


class PayoffStrategyIn(BaseModel):
    strategy: str = "snowball"
    extra_monthly_payment: Decimal = Decimal("0.00")


class PayoffStrategyLoan(BaseModel):
    loan_id: uuid.UUID
    name: str
    order: int
    principal: Decimal
    interest_rate: Decimal
    minimum_payment: Decimal
    rationale: str


class PayoffStrategyOut(BaseModel):
    strategy: str
    ordered_plan: list[PayoffStrategyLoan]


class LoanPaymentIn(BaseModel):
    payment_date: date
    amount: Decimal
    note: str | None = None


class LoanPaymentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    loan_id: uuid.UUID
    payment_date: date
    amount: Decimal
    interest_component: Decimal | None = None
    principal_component: Decimal | None = None
    balance_after: Decimal | None = None
    note: str | None = None


class LoanPaymentListOut(BaseModel):
    items: list[LoanPaymentOut]
    total: int
