"""Pure alert producers. Each returns AlertSpec objects carrying a stable
signature so the engine can upsert and auto-resolve. derive_alert_specs ports
the deterministic rules from app.analyst.service.derive_alerts; unlike that
function it emits NO 'all clear' filler — an empty list means nothing is wrong."""

from __future__ import annotations

from pydantic import BaseModel

from app.analyst.schemas import FinancialSnapshot


class AlertSpec(BaseModel):
    kind: str
    producer: str
    severity: int
    tone: str
    signature: str
    title: str
    detail: str
    suggested_action: dict | None = None
    supporting_refs: list | None = None


def derive_alert_specs(snapshot: FinancialSnapshot) -> list[AlertSpec]:
    specs: list[AlertSpec] = []
    for budget in snapshot.budget_overages:
        cid = budget.get("category_id")
        specs.append(AlertSpec(
            kind="budget_overspend", producer="deterministic", severity=9, tone="danger",
            signature=f"budget_overspend:{cid}",
            title=f"{budget.get('name', 'A budget')} is over",
            detail=(f"Over by {snapshot.currency} {budget.get('over', 0):.0f} "
                    f"({budget.get('pct', 0):.0f}% of limit)."),
            suggested_action={"type": "set_budget",
                              "label": f"Adjust {budget.get('name', 'budget')}",
                              "params": {"category_id": cid}},
        ))
    if snapshot.net < 0:
        specs.append(AlertSpec(
            kind="negative_cashflow", producer="deterministic", severity=8, tone="warning",
            signature="negative_cashflow", title="Cash flow is negative",
            detail=f"Spending exceeds income by {snapshot.currency} {abs(snapshot.net):.0f} this period.",
            suggested_action={"type": "focus_widget", "label": "View cashflow", "params": {"widget": "cashflow"}},
        ))
    for budget in snapshot.near_limit_budgets:
        cid = budget.get("category_id")
        specs.append(AlertSpec(
            kind="budget_near_limit", producer="deterministic", severity=5, tone="info",
            signature=f"budget_near_limit:{cid}",
            title=f"{budget.get('name', 'A budget')} near its limit",
            detail=f"{budget.get('pct', 0):.0f}% of the limit used.",
        ))
    for rec in snapshot.recommendations:
        specs.append(AlertSpec(
            kind=str(rec.get("type", "recommendation")), producer="deterministic", severity=6, tone="info",
            signature=f"rec:{rec.get('id')}", title="Heads up",
            detail=str(rec.get("message") or "Review this recommendation."),
        ))
    return specs
