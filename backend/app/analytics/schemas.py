from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class AnalyticsRow(BaseModel):
    dimensions: dict[str, str | None]
    total: Decimal
    quantity: Decimal | None = None
    contribution_pct: Decimal | None = None
    transaction_ids: list[uuid.UUID] = Field(default_factory=list)


class AnalyticsSummaryOut(BaseModel):
    from_date: date
    to_date: date
    group_by: list[str]
    total: Decimal
    rows: list[AnalyticsRow]
    comparison: dict | None = None


class TimeSeriesPoint(BaseModel):
    period: str
    spend: Decimal = Decimal("0.00")
    income: Decimal = Decimal("0.00")
    net: Decimal = Decimal("0.00")


class TimeSeriesOut(BaseModel):
    metric: str
    interval: str
    from_date: date
    to_date: date
    points: list[TimeSeriesPoint]


class BreakdownOut(BaseModel):
    dimension: str
    filter: str | None = None
    rows: list[AnalyticsRow]


class NetWorthPoint(BaseModel):
    period: str
    assets: Decimal
    liabilities: Decimal
    net_worth: Decimal


class NetWorthOut(BaseModel):
    as_of: date
    currency: str
    assets: Decimal
    liabilities: Decimal
    net_worth: Decimal
    points: list[NetWorthPoint]


class BudgetIn(BaseModel):
    category_id: uuid.UUID | None = None
    period: str = "monthly"
    amount: Decimal
    currency: str = "USD"


class BudgetPatch(BaseModel):
    category_id: uuid.UUID | None = None
    period: str | None = None
    amount: Decimal | None = None
    currency: str | None = None


class BudgetOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    household_id: uuid.UUID
    category_id: uuid.UUID | None = None
    period: str
    amount: Decimal
    currency: str
    spent: Decimal = Decimal("0.00")
    remaining: Decimal = Decimal("0.00")
    progress_pct: Decimal = Decimal("0.00")
    overspent: bool = False


class RecommendationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    household_id: uuid.UUID
    user_id: uuid.UUID | None = None
    type: str
    payload: dict | None = None
    supporting_refs: dict | None = None
    generated_at: datetime | None = None
    dismissed: bool
