from __future__ import annotations

from datetime import date
from decimal import Decimal

from pydantic import BaseModel


class FXRateOut(BaseModel):
    pair: str
    requested_date: date
    rate_date: date
    rate: Decimal


class FXRefreshOut(BaseModel):
    requested: int
    refreshed: int
    failed: int
    skipped: int
    errors: list[str]
