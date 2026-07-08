from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, Field

Tone = Literal["positive", "info", "warning", "danger"]
Mode = Literal["explain", "plan", "action"]
ActionType = Literal[
    "create_widget",
    "open_personalize",
    "focus_widget",
    "set_budget",
    "snooze_alert",
    "dismiss_alert",
]

ACTION_TYPES = frozenset(
    {"create_widget", "open_personalize", "focus_widget", "set_budget", "snooze_alert", "dismiss_alert"}
)


class AnalystAction(BaseModel):
    type: ActionType
    label: str
    params: dict[str, str | int | float | bool | None] = Field(default_factory=dict)


class AnalystAlert(BaseModel):
    id: str
    kind: str
    severity: int = Field(ge=0, le=10)
    tone: Tone
    title: str
    detail: str
    suggested_action: AnalystAction | None = None


class AlertRef(BaseModel):
    """A provenance pointer backing an alert (the record an insight cites)."""
    source_type: str
    source_id: str


class PersistentAlert(BaseModel):
    id: str
    kind: str
    severity: int = Field(ge=0, le=10)
    tone: Tone
    state: Literal["active", "acknowledged", "resolved"]
    title: str
    detail: str
    suggested_action: AnalystAction | None = None
    supporting_refs: list[AlertRef] = []
    acknowledged_at: datetime | None = None
    resolved_at: datetime | None = None


class MonitorOut(BaseModel):
    alerts: list[PersistentAlert]


class PageContext(BaseModel):
    route: str | None = None
    entity: str | None = None
    visible_range: str | None = None
    filters: dict[str, Any] | None = None


class AnalystAskIn(BaseModel):
    mode: Mode
    question: str = Field(min_length=1)
    range_from: str | None = None
    range_to: str | None = None
    focus_kind: Literal["merchant", "category"] | None = None
    focus_label: str | None = None
    focus_id: str | None = None
    page: str | None = None
    thread_id: str | None = None
    page_context: PageContext | None = None


class AnalystAskOut(BaseModel):
    answer: str
    suggestions: list[AnalystAction] = Field(default_factory=list)
    available: bool = True
    citations: list[dict] = []
    thread_id: str | None = None


class AnalystActionResponse(BaseModel):
    answer: str
    actions: list[AnalystAction] = Field(default_factory=list)


class AnalystThreadMessage(BaseModel):
    role: Literal["user", "analyst"]
    text: str


class AnalystThreadOut(BaseModel):
    messages: list[AnalystThreadMessage] = Field(default_factory=list)


class FinancialSnapshot(BaseModel):
    period_from: str | None = None
    period_to: str | None = None
    period_days: int | None = None
    currency: str
    income: float
    expenses: float
    net: float
    net_delta_pct: float | None = None
    net_worth: float
    assets: float
    liabilities: float
    budget_overages: list[dict[str, Any]] = Field(default_factory=list)
    near_limit_budgets: list[dict[str, Any]] = Field(default_factory=list)
    top_categories: list[dict[str, Any]] = Field(default_factory=list)
    upcoming_recurring: list[dict[str, Any]] = Field(default_factory=list)
    recurring_monthly_total: float = 0.0
    credit_cards: list[dict[str, Any]] = Field(default_factory=list)
    loans: list[dict[str, Any]] = Field(default_factory=list)
    holdings: list[dict[str, Any]] = Field(default_factory=list)
    income_sources: list[dict[str, Any]] = Field(default_factory=list)
    recommendations: list[dict[str, Any]] = Field(default_factory=list)


class MemorySourceStatus(BaseModel):
    source_type: str
    count: int
    last_indexed: datetime | None = None


class MemoryStatusOut(BaseModel):
    sources: list[MemorySourceStatus] = Field(default_factory=list)
    last_synced: datetime | None = None


class ReindexOut(BaseModel):
    documents: int = 0
    transactions: int = 0
    loans: int = 0
    recurring: int = 0
    accounts: int = 0
    account_balances: int = 0
    payment_methods: int = 0
    budgets: int = 0
    merchants: int = 0
    categories: int = 0
    tags: int = 0
    rules: int = 0
    income_sources: int = 0
    investment_holdings: int = 0
    holding_valuations: int = 0


class DebtPlanLLM(BaseModel):
    """The narrow set of judgment calls the LLM is allowed to make."""
    strategy: Literal["snowball", "avalanche"]
    extra_monthly: float = Field(ge=0)
    headline: str
    narrative: str = ""


AggressionLevel = Literal[
    "comfortable",
    "balanced",
    "aggressive",
    "asap",
]


class DebtPlanRequest(BaseModel):
    aggression_level: AggressionLevel | None = None


class DebtPlanOrderItem(BaseModel):
    loan_id: uuid.UUID
    name: str
    order: int
    extra_allocation: Decimal
    rationale: str
    impact: str
    interest_rate: Decimal | None = None
    balance: Decimal | None = None
    priority_reason: str = ""


class DebtPlanMilestones(BaseModel):
    first_loan_paid_off_months: int | None = None
    next_loan_paid_off_months: int | None = None
    payoff_accelerated_months: int
    estimated_interest_saved: Decimal
    monthly_cash_still_left: Decimal
    confidence_level: Literal["Low", "Medium", "High"]


class DebtPlanPhase(BaseModel):
    phase: str
    action: str
    extra_payment_target: str
    expected_result: str
    roll_payments: str


class DebtPlanAlternative(BaseModel):
    aggression_level: AggressionLevel
    label: str
    extra_payoff_amount: Decimal
    estimated_payoff_improvement_months: int
    interest_saved: Decimal
    best_for: str


class DebtPlanReasoning(BaseModel):
    why_this_loan_first: str
    why_this_extra_amount: str
    tradeoff: str
    investing_note: str
    risk_notes: list[str] = Field(default_factory=list)


class DebtPlanOut(BaseModel):
    available: bool = True
    source: Literal["ai", "deterministic"]
    strategy: str
    aggression_level: AggressionLevel | None = None
    recommendation_name: str = ""
    extra_monthly: Decimal
    affordable_extra: Decimal = Decimal("0.00")
    headline: str
    narrative: str = ""
    ordered: list[DebtPlanOrderItem] = Field(default_factory=list)
    milestones: DebtPlanMilestones | None = None
    phases: list[DebtPlanPhase] = Field(default_factory=list)
    reasoning: DebtPlanReasoning | None = None
    alternatives: list[DebtPlanAlternative] = Field(default_factory=list)
    final_recommendation: str = ""
    currency: str
    interest_saved: Decimal
    months_sooner: int
    baseline_payoff_date: date | None = None
    optimized_payoff_date: date | None = None
    updated_at: datetime
