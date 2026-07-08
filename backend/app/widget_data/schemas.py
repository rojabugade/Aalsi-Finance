from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.loans.schemas import LoanOut


class PaymentMethodIn(BaseModel):
    account_id: uuid.UUID | None = None
    type: Literal["card", "bank", "wallet", "cash"]
    name: str = Field(min_length=1, max_length=255)
    last4: str | None = Field(default=None, min_length=4, max_length=4, pattern=r"^\d{4}$")
    network: str | None = Field(default=None, max_length=32)
    is_active: bool = True


class PaymentMethodPatch(BaseModel):
    account_id: uuid.UUID | None = None
    type: Literal["card", "bank", "wallet", "cash"] | None = None
    name: str | None = Field(default=None, min_length=1, max_length=255)
    last4: str | None = Field(default=None, min_length=4, max_length=4, pattern=r"^\d{4}$")
    network: str | None = Field(default=None, max_length=32)
    is_active: bool | None = None


class PaymentMethodOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    household_id: uuid.UUID
    owner_user_id: uuid.UUID | None = None
    account_id: uuid.UUID | None = None
    type: str
    name: str
    last4: str | None = None
    network: str | None = None
    is_active: bool


class CreditCardDetailIn(BaseModel):
    credit_limit: Decimal = Field(gt=0)
    statement_balance: Decimal | None = Field(default=None, ge=0)
    available_credit: Decimal | None = Field(default=None, ge=0)
    statement_day: int | None = Field(default=None, ge=1, le=31)


class CreditCardOut(BaseModel):
    loan: LoanOut
    credit_limit: Decimal | None = None
    statement_balance: Decimal | None = None
    available_credit: Decimal | None = None
    statement_day: int | None = None
    utilization: Decimal | None = None
    detail_complete: bool


class RecurringSeriesIn(BaseModel):
    merchant_id: uuid.UUID | None = None
    category_id: uuid.UUID | None = None
    account_id: uuid.UUID | None = None
    payment_method_id: uuid.UUID | None = None
    name: str = Field(min_length=1, max_length=255)
    amount: Decimal | None = Field(default=None, ge=0)
    currency: str = Field(default="USD", min_length=3, max_length=3)
    cadence: Literal["weekly", "biweekly", "monthly", "quarterly", "annual", "irregular"]
    type: Literal["subscription", "bill", "income", "transfer", "other"]
    status: Literal["active", "paused", "ended"] = "active"
    next_due_date: date | None = None
    start_date: date | None = None
    end_date: date | None = None


class RecurringSeriesPatch(BaseModel):
    merchant_id: uuid.UUID | None = None
    category_id: uuid.UUID | None = None
    account_id: uuid.UUID | None = None
    payment_method_id: uuid.UUID | None = None
    name: str | None = Field(default=None, min_length=1, max_length=255)
    amount: Decimal | None = Field(default=None, ge=0)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    cadence: Literal["weekly", "biweekly", "monthly", "quarterly", "annual", "irregular"] | None = None
    type: Literal["subscription", "bill", "income", "transfer", "other"] | None = None
    status: Literal["active", "paused", "ended"] | None = None
    next_due_date: date | None = None
    start_date: date | None = None
    end_date: date | None = None


class RecurringSeriesOut(RecurringSeriesIn):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    household_id: uuid.UUID
    owner_user_id: uuid.UUID | None = None
    merchant_name: str | None = None
    category_name: str | None = None


class HoldingIn(BaseModel):
    account_id: uuid.UUID
    asset_type: Literal["stock", "etf", "mutual_fund", "crypto", "bond", "other"]
    symbol: str | None = Field(default=None, max_length=32)
    name: str = Field(min_length=1, max_length=255)
    quantity: Decimal = Field(ge=0)
    avg_buy_price: Decimal | None = Field(default=None, ge=0)
    currency: str = Field(default="USD", min_length=3, max_length=3)


class HoldingPatch(BaseModel):
    account_id: uuid.UUID | None = None
    asset_type: Literal["stock", "etf", "mutual_fund", "crypto", "bond", "other"] | None = None
    symbol: str | None = Field(default=None, max_length=32)
    name: str | None = Field(default=None, min_length=1, max_length=255)
    quantity: Decimal | None = Field(default=None, ge=0)
    avg_buy_price: Decimal | None = Field(default=None, ge=0)
    currency: str | None = Field(default=None, min_length=3, max_length=3)


class ValuationIn(BaseModel):
    as_of: date
    price: Decimal = Field(ge=0)
    value: Decimal | None = Field(default=None, ge=0)


class ValuationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    household_id: uuid.UUID
    holding_id: uuid.UUID
    as_of: date
    price: Decimal
    value: Decimal


class HoldingOut(HoldingIn):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    household_id: uuid.UUID
    owner_user_id: uuid.UUID | None = None
    latest_valuation: ValuationOut | None = None
