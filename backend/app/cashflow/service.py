from __future__ import annotations

from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import scoped_query
from app.cashflow.schemas import CashflowLine, CashflowSummary
from app.fx import service as fx_service
from app.loans import service as loans_service
from app.models.core import User
from app.models.income import IncomeSource
from app.models.transactions import Category, Transaction
from app.widget_data import service as widgets

CADENCE_FACTOR: dict[str, Decimal] = {
    "weekly": Decimal("4.33"),
    "biweekly": Decimal("2.17"),
    "monthly": Decimal("1"),
    "quarterly": Decimal("1") / Decimal("3"),
    "annual": Decimal("1") / Decimal("12"),
    "irregular": Decimal("0"),
}
FREQ_MULT: dict[str, Decimal] = {
    "weekly": Decimal("52"),
    "biweekly": Decimal("26"),
    "semimonthly": Decimal("24"),
    "monthly": Decimal("12"),
    "annual": Decimal("1"),
}
CARD_MIN_FLOOR = Decimal("25.00")
CARD_MIN_PCT = Decimal("0.02")


def _money(value) -> Decimal:
    return Decimal(str(value or "0")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def monthly_from_cadence(amount: Decimal, cadence: str) -> Decimal:
    return _money(_money(amount) * CADENCE_FACTOR.get(cadence, Decimal("0")))


def monthly_from_frequency(net: Decimal, frequency: str) -> Decimal:
    return _money(_money(net) * FREQ_MULT.get(frequency, Decimal("12")) / Decimal("12"))


def _is_income_transaction(txn: Transaction, categories: dict) -> bool:
    if (txn.flags or {}).get("type") == "income":
        return True
    category = categories.get(txn.category_id)
    if category is None:
        return False
    parent = categories.get(category.parent_id) if category.parent_id else None
    return category.name.lower() == "income" or (parent is not None and parent.name.lower() == "income")


async def _income_monthly(
    session: AsyncSession, user: User, base_currency: str, recurring: list[dict]
) -> Decimal:
    sources = list((await session.execute(scoped_query(IncomeSource, user))).scalars().all())
    total = Decimal("0.00")
    if sources:
        for src in sources:
            net = src.net if src.net is not None else src.gross
            if net is None:
                continue
            monthly = monthly_from_frequency(_money(net), src.frequency)
            try:
                monthly = (
                    await fx_service.convert(
                        session, monthly, src.currency, base_currency, date.today()
                    )
                )[0]
            except fx_service.FXRateUnavailable:
                pass
            total += monthly
        return _money(total)
    # Fallback: detected recurring income series only.
    for row in recurring:
        if row.get("type") == "income":
            total += monthly_from_cadence(_money(row.get("amount")), row.get("cadence", "monthly"))
    return _money(total)


async def _discretionary_monthly(
    session: AsyncSession, user: User, base_currency: str, months: int
) -> Decimal:
    since = date.today() - timedelta(days=months * 30)
    stmt = scoped_query(Transaction, user).where(
        Transaction.txn_date >= since,
        Transaction.status == "confirmed",
    )
    txns = list((await session.execute(stmt)).scalars().all())
    cat_ids = [t.category_id for t in txns if t.category_id]
    cats = (
        {
            c.id: c
            for c in (
                await session.execute(select(Category).where(Category.id.in_(cat_ids)))
            ).scalars().all()
        }
        if cat_ids
        else {}
    )
    # Mirror analytics._aggregate exclusions: transfer/payment legs are money
    # movement (a card autopay is already counted under card minimums / debt EMI),
    # and refunds net spend down instead of inflating it.
    total = Decimal("0.00")
    for txn in txns:
        if txn.recurring_series_id is not None:
            continue  # already counted under recurring
        flags = txn.flags or {}
        if flags.get("transfer"):
            continue
        if _is_income_transaction(txn, cats):
            continue
        amount = _money(txn.base_amount if txn.base_amount is not None else txn.amount)
        if flags.get("refund"):
            total -= abs(amount)
        else:
            total += abs(amount)
    total = max(total, Decimal("0.00"))
    return _money(total / Decimal(str(months)))


def _card_min(card: dict) -> Decimal:
    """Monthly minimum for one credit card. Prefer the issuer's real minimum
    (Plaid liabilities sync writes it to loan.min_or_emi_amount); fall back to
    the max($25, 2% of statement) heuristic only when it's missing."""
    balance = _money(card.get("statement_balance"))
    if balance <= 0:
        return Decimal("0.00")
    real_min = _money((card.get("loan") or {}).get("min_or_emi_amount"))
    if real_min > 0:
        return real_min
    return max(CARD_MIN_FLOOR, _money(balance * CARD_MIN_PCT))


async def build_cashflow_summary(
    session: AsyncSession, user: User, months: int = 6
) -> CashflowSummary:
    base_currency = await fx_service.household_base_currency(session, user.household_id)
    recurring = await widgets.list_recurring(session, user, status="active")
    cards = await widgets.list_credit_cards(session, user)
    loans = await loans_service.list_loans(session, user)

    income = await _income_monthly(session, user, base_currency, recurring)
    recurring_monthly = sum(
        (
            monthly_from_cadence(_money(r.get("amount")), r.get("cadence", "monthly"))
            for r in recurring
            if r.get("type") != "income"
        ),
        Decimal("0.00"),
    )
    debt_emi = sum(
        (_money(l.get("min_or_emi_amount")) for l in loans if l.get("type") != "credit_card"),
        Decimal("0.00"),
    )
    card_min = sum((_card_min(c) for c in cards), Decimal("0.00"))
    discretionary = await _discretionary_monthly(session, user, base_currency, months)
    leftover = _money(income - recurring_monthly - debt_emi - card_min - discretionary)

    breakdown = [
        CashflowLine(label="Income", amount=income, kind="income"),
        CashflowLine(label="Recurring", amount=-recurring_monthly, kind="recurring"),
        CashflowLine(label="Debt payments", amount=-debt_emi, kind="debt"),
        CashflowLine(label="Card minimums", amount=-card_min, kind="card"),
        CashflowLine(label="Everyday spend", amount=-discretionary, kind="discretionary"),
        CashflowLine(label="Left over", amount=leftover, kind="leftover"),
    ]
    return CashflowSummary(
        currency=base_currency,
        income_monthly=income,
        recurring_monthly=_money(recurring_monthly),
        debt_emi_monthly=_money(debt_emi),
        card_min_monthly=_money(card_min),
        discretionary_monthly=discretionary,
        leftover_monthly=leftover,
        breakdown=breakdown,
    )
