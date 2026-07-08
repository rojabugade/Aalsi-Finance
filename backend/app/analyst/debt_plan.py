from __future__ import annotations

from datetime import date
from decimal import Decimal

from app.analyst.schemas import DebtPlanOrderItem
from app.loans.service import _money, _rate
from app.models.debt import Loan

_REASON = {
    "avalanche": "highest interest rate first minimizes total interest",
    "snowball": "smallest balance first builds momentum with quick wins",
}

_MONTH_CAP = 600

# Revolving cards recompute their minimum each statement as a percentage of the
# current balance (with a floor). ~2% matches typical US card terms and keeps the
# later-month payments realistic instead of frozen at the opening minimum.
_REVOLVING_MIN_PCT = Decimal("0.02")


def _is_revolving(loan: Loan) -> bool:
    return getattr(loan, "schedule_kind", None) == "revolving"


def _outstanding(loan: Loan) -> Decimal:
    # Plan from what's still owed, not the original principal. service.py attaches
    # outstanding_balance from recorded payments; unit tests pass bare loans and
    # fall back to principal.
    value = getattr(loan, "outstanding_balance", None)
    if value is None:
        value = loan.principal
    return _money(value)


def _monthly_rate(loan: Loan) -> Decimal:
    # annual / 12, matching the frontend simulateStrategy exactly so the card and
    # the chart never disagree. (Daily compounding is intentionally ignored here;
    # this is a forward-looking plan estimate, not the amortization ledger.)
    return _rate(loan.interest_rate) / Decimal("12")


def _min_payment(loan: Loan) -> Decimal:
    # Mirror the frontend paymentOf: the loan's minimum, or 2% of outstanding so a
    # payment-less loan still terminates instead of running to the month cap. This is
    # the *floor*; revolving loans lift it to a % of the live balance each month.
    # `min_amount_base` (when set by the assembly layer) is the minimum already
    # converted to the household base currency for a mixed-currency plan.
    override = getattr(loan, "min_amount_base", None)
    if override is not None:
        minimum = _money(override)
    elif loan.min_or_emi_amount is not None:
        minimum = _money(loan.min_or_emi_amount)
    else:
        minimum = Decimal("0.00")
    if minimum > 0:
        return minimum
    return _money(max(Decimal("1"), _outstanding(loan) * Decimal("0.02")))


def _promo_monthly_rate(loan: Loan) -> Decimal | None:
    # Intro-APR monthly rate, or None when the loan carries no promo.
    rate = getattr(loan, "promo_rate", None)
    if rate is None:
        return None
    return _rate(rate) / Decimal("12")


def _promo_until_month(loan: Loan, today: date) -> int:
    # Number of months from today the promo rate stays in effect. Month index N in the
    # sim is "promo" while N <= this value; 0 means no active promo.
    expiry = getattr(loan, "promo_expiry_date", None)
    rate = getattr(loan, "promo_rate", None)
    if expiry is None or rate is None:
        return 0
    months = (expiry.year - today.year) * 12 + (expiry.month - today.month)
    return max(0, months)


def _projected_spend(loan: Loan) -> Decimal:
    # New charges assumed each month on a revolving card. Off (0) unless the caller
    # attaches projected_monthly_spend, so payoff sims stay optimistic by default and
    # only model "you keep charging" when explicitly asked.
    if not _is_revolving(loan):
        return Decimal("0.00")
    value = getattr(loan, "projected_monthly_spend", None)
    if value is None:
        return Decimal("0.00")
    return max(Decimal("0.00"), _money(value))


def order_loans(loans: list[Loan], strategy: str) -> list[Loan]:
    if strategy == "avalanche":
        return sorted(loans, key=lambda loan: (-_rate(loan.interest_rate), _outstanding(loan)))
    return sorted(loans, key=lambda loan: (_outstanding(loan), -_rate(loan.interest_rate)))


def simulate_strategy(loans: list[Loan], extra_monthly: Decimal, strategy: str) -> dict:
    """Month-by-month payoff with rollover ("waterfall"), ported from the frontend
    simulateStrategy. Each month every loan accrues interest and pays its minimum;
    a pool (extra + minimums freed by paid-off loans + minimum over-shoot) cascades
    down the strategy order, so clearing the top loan accelerates every loan below.

    Returns {"months", "interest", "payoff_date", "series"} where series is the
    summed balance at month 0..N.
    """
    extra = max(Decimal("0.00"), _money(extra_monthly))
    today = date.today()
    state = [
        {
            "id": loan.id,
            "bal": _outstanding(loan),
            "rate": _monthly_rate(loan),
            "promo_rate": _promo_monthly_rate(loan),
            "promo_until": _promo_until_month(loan, today),
            "min": _min_payment(loan),
            "spend": _projected_spend(loan),
            "revolving": _is_revolving(loan),
        }
        for loan in loans
    ]
    by_id = {s["id"]: s for s in state}
    initial_priority_ids = [loan.id for loan in order_loans(loans, strategy)]
    initial_priority = [by_id[i] for i in initial_priority_ids if i in by_id]
    # Avalanche ranks by rate; a promo makes a card's effective rate change over time,
    # so with any promo present we re-rank each month by the rate in force. Without a
    # promo the effective rate is constant, so this reproduces the fixed order exactly.
    reranks = strategy == "avalanche" and any(s["promo_rate"] is not None for s in state)

    def eff_rate(s: dict, month: int) -> Decimal:
        if s["promo_rate"] is not None and month <= s["promo_until"]:
            return s["promo_rate"]
        return s["rate"]

    total_interest = Decimal("0.00")
    start_balance = sum((s["bal"] for s in state), Decimal("0.00"))
    series: list[Decimal] = [_money(start_balance)]
    clear_month: dict = {}
    extra_start: dict = {}
    cleared: set = set()
    month = 0
    while month < _MONTH_CAP and any(s["bal"] > 0 for s in state):
        month += 1
        paid = {s["id"]: {"minimum": Decimal("0.00"), "extra": Decimal("0.00")} for s in state}
        # 1. New charges on still-open revolving cards, then accrue interest at the
        #    rate in force this month (promo until it expires, then the standard rate).
        for s in state:
            if s["bal"] <= 0 and s["id"] in cleared:
                continue
            if s["revolving"] and s["id"] not in cleared and s["spend"] > 0:
                s["bal"] += s["spend"]
            if s["bal"] <= 0:
                continue
            interest = s["bal"] * eff_rate(s, month)
            s["bal"] += interest
            total_interest += interest
        # 2. Pay minimums; cleared loans and minimum over-shoot feed the pool. Revolving
        #    cards recompute the minimum as a % of the live balance (floored at `min`).
        pool = extra
        for s in state:
            if s["bal"] <= 0:
                pool += s["min"]
                continue
            min_due = max(s["min"], s["bal"] * _REVOLVING_MIN_PCT) if s["revolving"] else s["min"]
            pay = min(s["bal"], min_due)
            s["bal"] -= pay
            paid[s["id"]]["minimum"] = pay
            pool += min_due - pay
        # 3. Cascade the pool down the priority order, overflowing as loans clear.
        priority = (
            sorted(state, key=lambda s: (-eff_rate(s, month), s["bal"]))
            if reranks
            else initial_priority
        )
        for s in priority:
            if pool <= 0:
                break
            if s["bal"] <= 0:
                continue
            pay = min(s["bal"], pool)
            s["bal"] -= pay
            pool -= pay
            paid[s["id"]]["extra"] += pay
        for s in state:
            s["bal"] = _money(s["bal"]) if s["bal"] > 0 else Decimal("0.00")
            if paid[s["id"]]["extra"] > 0 and s["id"] not in extra_start:
                extra_start[s["id"]] = month
            if s["bal"] <= 0 and s["id"] not in clear_month:
                clear_month[s["id"]] = month
                cleared.add(s["id"])
        series.append(_money(sum((s["bal"] for s in state), Decimal("0.00"))))

    payoff_date: date | None = None
    if any(s["bal"] > 0 for s in state):
        payoff_date = None  # did not pay off within the cap
    elif month > 0:
        idx = today.month - 1 + month
        payoff_date = date(today.year + idx // 12, idx % 12 + 1, 1)
    return {
        "months": month,
        "interest": _money(total_interest),
        "payoff_date": payoff_date,
        "series": series,
        "timeline": [
            {
                "loan_id": s["id"],
                "clear_month": clear_month.get(s["id"], 0),
                "extra_start_month": extra_start.get(s["id"], 0),
            }
            for s in initial_priority
        ],
    }


def project_total(loans: list[Loan], extra_monthly: Decimal, strategy: str) -> dict:
    sim = simulate_strategy(loans, extra_monthly, strategy)
    return {"months": sim["months"], "interest": sim["interest"], "payoff_date": sim["payoff_date"]}


def build_ordered(loans: list[Loan], extra_monthly: Decimal, strategy: str) -> list[DebtPlanOrderItem]:
    ordered = order_loans(loans, strategy)
    reason = _REASON.get(strategy, _REASON["snowball"])
    items: list[DebtPlanOrderItem] = []
    top_rate = _rate(ordered[0].interest_rate) if ordered else Decimal("0")
    for idx, loan in enumerate(ordered, start=1):
        first = idx == 1
        rate = _rate(loan.interest_rate)
        balance = _outstanding(loan)
        if strategy == "avalanche":
            if first:
                priority_reason = "Highest APR, so each extra dollar avoids the most interest."
            elif top_rate - rate <= Decimal("0.015"):
                priority_reason = "Rate is close to the target; smaller balances can become quick wins after the top debt clears."
            else:
                priority_reason = "Lower APR; keep it on minimum payment until higher-rate debt is gone."
        else:
            priority_reason = "Smallest balance first; useful when quick wins matter more than pure interest minimization."
        items.append(
            DebtPlanOrderItem(
                loan_id=loan.id,
                name=loan.name,
                order=idx,
                extra_allocation=_money(extra_monthly) if first else Decimal("0.00"),
                rationale=reason,
                impact="Highest impact" if first else "Maintain minimum",
                interest_rate=loan.interest_rate,
                balance=balance,
                priority_reason=priority_reason,
            )
        )
    return items
