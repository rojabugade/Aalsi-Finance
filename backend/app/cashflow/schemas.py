from __future__ import annotations

from decimal import Decimal

from pydantic import BaseModel


class CashflowLine(BaseModel):
    label: str
    amount: Decimal
    kind: str  # income | recurring | debt | card | discretionary | leftover


class CashflowSummary(BaseModel):
    currency: str
    income_monthly: Decimal
    recurring_monthly: Decimal
    debt_emi_monthly: Decimal
    card_min_monthly: Decimal
    discretionary_monthly: Decimal
    leftover_monthly: Decimal
    breakdown: list[CashflowLine]
