from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class IncomeSourceIn(BaseModel):
    employer: str | None = None
    country: str | None = None
    currency: str = "USD"
    frequency: str = "monthly"
    gross: Decimal | None = None
    net: Decimal | None = None
    withholding: dict | None = None


class IncomeSourcePatch(BaseModel):
    employer: str | None = None
    country: str | None = None
    currency: str | None = None
    frequency: str | None = None
    gross: Decimal | None = None
    net: Decimal | None = None
    withholding: dict | None = None


class IncomeSourceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    owner_user_id: uuid.UUID | None = None
    employer: str | None = None
    country: str | None = None
    currency: str
    frequency: str
    gross: Decimal | None = None
    net: Decimal | None = None
    withholding: dict | None = None


class PaystubIn(BaseModel):
    income_source_id: uuid.UUID
    source_document_id: uuid.UUID | None = None
    period_start: date | None = None
    period_end: date | None = None
    gross: Decimal | None = None
    deductions: dict | None = None
    net: Decimal | None = None


class PaystubOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    income_source_id: uuid.UUID
    source_document_id: uuid.UUID | None = None
    period_start: date | None = None
    period_end: date | None = None
    gross: Decimal | None = None
    deductions: dict | None = None
    net: Decimal | None = None


class EquityGrantIn(BaseModel):
    income_source_id: uuid.UUID
    type: str
    ticker: str | None = None
    country: str | None = None
    grant_date: date | None = None
    shares: Decimal | None = None
    strike_price: Decimal | None = None
    vesting_schedule: dict | None = None


class EquityGrantOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    income_source_id: uuid.UUID
    type: str
    ticker: str | None = None
    country: str | None = None
    grant_date: date | None = None
    shares: Decimal | None = None
    strike_price: Decimal | None = None
    vesting_schedule: dict | None = None


class EquityEventIn(BaseModel):
    equity_grant_id: uuid.UUID
    type: str
    event_date: date | None = None
    shares: Decimal | None = None
    fmv: Decimal | None = None
    proceeds: Decimal | None = None
    est_tax: dict | None = None


class EquityEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    equity_grant_id: uuid.UUID
    type: str
    event_date: date | None = None
    shares: Decimal | None = None
    fmv: Decimal | None = None
    proceeds: Decimal | None = None
    est_tax: dict | None = None


class EquitySummaryGrant(BaseModel):
    grant_id: uuid.UUID
    ticker: str | None = None
    type: str
    vested_shares: Decimal
    unvested_shares: Decimal
    vested_value: Decimal
    upcoming_vests: list[dict] = Field(default_factory=list)


class EquitySummaryOut(BaseModel):
    vested_value: Decimal
    unvested_shares: Decimal
    grants: list[EquitySummaryGrant]
    disclaimer: str


class TakeHomeOut(BaseModel):
    source_id: uuid.UUID
    country: str | None = None
    currency: str
    gross_period: Decimal
    gross_annual: Decimal
    estimates: dict
    disclaimer: str
    base_currency: str | None = None
    gross_period_base: Decimal | None = None
    gross_annual_base: Decimal | None = None
