from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


GuidanceDomain = Literal["general", "investment", "cross_border"]
GuidancePlanStatus = Literal["open", "completed", "dismissed"]


def _nonempty_title(value: str) -> str:
    normalized = " ".join(value.split())
    if not normalized:
        raise ValueError("title must not be blank")
    return normalized


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


class GuidancePlanItemCreate(BaseModel):
    title: str = Field(min_length=1, max_length=240)
    rationale: str | None = None
    domain: GuidanceDomain
    due_date: date | None = None
    source_refs: list[dict] | None = None
    origin_thread_key: str | None = Field(default=None, max_length=96)

    _normalize_title = field_validator("title")(_nonempty_title)


class GuidancePlanItemUpdate(BaseModel):
    title: str = Field(default=None, min_length=1, max_length=240)
    rationale: str | None = None
    status: GuidancePlanStatus = Field(default=None)
    due_date: date | None = None

    _normalize_title = field_validator("title")(_nonempty_title)


class GuidancePlanItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    household_id: uuid.UUID
    user_id: uuid.UUID
    domain: GuidanceDomain
    title: str
    rationale: str | None = None
    status: GuidancePlanStatus
    due_date: date | None = None
    source_refs: list[dict] | None = None
    origin_thread_key: str | None = None
    created_at: datetime
    updated_at: datetime


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
