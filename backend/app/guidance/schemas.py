from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class Citation(BaseModel):
    title: str | None = None
    source_url: str | None = None
    source_type: str | None = None
    effective_date: date | None = None


class GuidanceAskIn(BaseModel):
    question: str
    country: str | None = None
    topic: str | None = None


class GuidanceAskOut(BaseModel):
    answer: str
    citations: list[Citation]
    disclaimer: str


class GuidanceWizardIn(BaseModel):
    countries: list[str] = Field(default_factory=lambda: ["US", "IN"])
    residency: str | None = None
    annual_transfer_amount: Decimal | None = None
    transfer_currency: str | None = None
    account_types: list[str] = Field(default_factory=list)


class GuidanceWizardOut(BaseModel):
    checklist: list[dict]
    reminders: list[dict]
    citations: list[Citation]
    disclaimer: str


class CrossBorderTransferIn(BaseModel):
    direction: str
    from_currency: str
    to_currency: str
    amount: Decimal
    fx_rate: Decimal | None = None
    purpose: str | None = None
    channel: str | None = None
    transfer_date: date | None = None
    base_currency: str | None = None
    base_amount: Decimal | None = None


class CrossBorderTransferOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    household_id: uuid.UUID
    owner_user_id: uuid.UUID | None = None
    direction: str
    from_currency: str
    to_currency: str
    amount: Decimal
    fx_rate: Decimal
    purpose: str | None = None
    channel: str | None = None
    transfer_date: date | None = None


class LimitsOut(BaseModel):
    totals: list[dict]
    limits: list[dict]
    warnings: list[dict]
    citations: list[Citation]


class ReindexOut(BaseModel):
    indexed: int
    corpus_dir: str
