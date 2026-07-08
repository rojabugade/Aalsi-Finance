from __future__ import annotations

from datetime import date

from sqlalchemy.ext.asyncio import AsyncSession

from app.analyst.schemas import FinancialSnapshot
from app.analytics import service as analytics
from app.income import service as income
from app.loans import service as loans_service
from app.models.core import User
from app.widget_data import service as widgets


def _f(value) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


async def build_snapshot(
    session: AsyncSession, user: User, from_date: date, to_date: date
) -> FinancialSnapshot:
    summary = await analytics.summary(session, user, from_date, to_date, ["category"], compare="prev")
    cashflow = await analytics.timeseries(session, user, "all", "monthly", from_date, to_date)
    category_breakdown = await analytics.breakdown(session, user, "category", None, from_date, to_date)
    net_worth = await analytics.net_worth(session, user, from_date, to_date)
    budgets = await analytics.list_budgets(session, user)
    recommendations = await analytics.recommendations(session, user)
    recurring = await widgets.list_recurring(session, user, status="active")
    cards = await widgets.list_credit_cards(session, user)
    loan_rows = await loans_service.list_loans(session, user)
    loans = [
        {
            "name": row.get("name"),
            "type": row.get("type"),
            "schedule_kind": row.get("schedule_kind"),
            "outstanding": _f(row.get("outstanding_balance") or row.get("principal")),
            "principal": _f(row.get("principal")),
            "interest_rate": (None if row.get("interest_rate") is None else _f(row.get("interest_rate"))),
            "monthly": (None if row.get("min_or_emi_amount") is None else _f(row.get("min_or_emi_amount"))),
            "next_due": row.get("next_due_date"),
        }
        for row in loan_rows
    ]

    holding_rows = await widgets.list_holdings(session, user)
    holdings = [
        {
            "name": row.get("name"),
            "symbol": row.get("symbol"),
            "asset_type": row.get("asset_type"),
            "quantity": _f(row.get("quantity")),
            "currency": row.get("currency"),
            "value": (None if row.get("latest_valuation") is None else _f(row["latest_valuation"].value)),
        }
        for row in holding_rows
    ]
    income_rows = await income.list_income_sources(session, user)
    income_sources = [
        {
            "employer": getattr(row, "employer", None),
            "frequency": getattr(row, "frequency", None),
            "currency": getattr(row, "currency", None),
            "gross": (None if getattr(row, "gross", None) is None else _f(row.gross)),
            "net": (None if getattr(row, "net", None) is None else _f(row.net)),
        }
        for row in income_rows
    ]

    rows = category_breakdown.get("rows") or []
    flow_points = cashflow.get("points") or []
    period_income = sum(_f(point.get("income")) for point in flow_points)
    expenses = sum(_f(point.get("spend")) for point in flow_points)
    comparison = summary.get("comparison") or {}

    overages: list[dict] = []
    near_limit: list[dict] = []
    for budget in budgets:
        category_id = budget.get("category_id")
        item = {
            "category_id": str(category_id) if category_id else None,
            "name": "Category" if category_id else "Overall budget",
            "pct": _f(budget.get("progress_pct")),
        }
        if budget.get("overspent"):
            overages.append(
                {**item, "over": max(0.0, _f(budget.get("spent")) - _f(budget.get("amount")))}
            )
        elif item["pct"] >= 80:
            near_limit.append(item)

    top_categories = [
        {
            "name": str(next(iter((row.get("dimensions") or {}).values()), "Other")),
            "amount": _f(row.get("total")),
        }
        for row in rows
        if _f(row.get("total")) > 0
    ][:5]

    return FinancialSnapshot(
        period_from=from_date.isoformat(),
        period_to=to_date.isoformat(),
        period_days=(to_date - from_date).days + 1,
        currency=str(net_worth.get("currency") or "USD"),
        income=period_income,
        expenses=expenses,
        net=period_income - expenses,
        net_delta_pct=_f(comparison.get("delta_pct")) if comparison else None,
        net_worth=_f(net_worth.get("net_worth")),
        assets=_f(net_worth.get("assets")),
        liabilities=_f(net_worth.get("liabilities")),
        budget_overages=overages,
        near_limit_budgets=near_limit,
        top_categories=top_categories,
        upcoming_recurring=[
            {
                "name": row.get("merchant_name") or row.get("name") or "Recurring",
                "amount": _f(row.get("amount")),
            }
            for row in recurring[:5]
        ],
        recurring_monthly_total=sum(_f(row.get("amount")) for row in recurring),
        credit_cards=[
            {
                "name": (card.get("loan") or {}).get("name", "Card"),
                "utilization": _f(card.get("utilization")),
            }
            for card in cards
        ],
        loans=loans,
        holdings=holdings,
        income_sources=income_sources,
        recommendations=[
            {
                "id": str(row.id),
                "type": row.type,
                "message": (row.payload or {}).get("message", ""),
            }
            for row in recommendations[:5]
        ],
    )
