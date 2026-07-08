"""M27 debt-plan sim upgrades: dynamic revolving minimums, promotional APR
re-ranking, projected new spend, and base-currency min override. Pure unit tests
against app.analyst.debt_plan — no DB, no session."""
from __future__ import annotations

import uuid
from datetime import date, timedelta
from decimal import Decimal

from app.analyst import debt_plan
from app.models.debt import Loan


def _loan(
    *,
    schedule_kind="amortizing",
    principal="10000",
    rate="12",
    minimum="100",
    outstanding=None,
    promo_rate=None,
    promo_expiry_date=None,
    projected_monthly_spend=None,
    name="Loan",
) -> Loan:
    loan = Loan(
        id=uuid.uuid4(),
        household_id=uuid.uuid4(),
        name=name,
        type="credit_card" if schedule_kind == "revolving" else "personal",
        schedule_kind=schedule_kind,
        principal=Decimal(principal),
        currency="USD",
        interest_rate=Decimal(rate),
        min_or_emi_amount=Decimal(minimum),
        promo_rate=Decimal(promo_rate) if promo_rate is not None else None,
        promo_expiry_date=promo_expiry_date,
    )
    if outstanding is not None:
        loan.outstanding_balance = Decimal(outstanding)
    if projected_monthly_spend is not None:
        loan.projected_monthly_spend = Decimal(projected_monthly_spend)
    return loan


def test_revolving_dynamic_min_pays_faster_than_flat_min():
    # 10k @ 12% (1%/mo -> $100 interest). A flat $100 minimum only covers interest and
    # never touches principal; a revolving card lifts the minimum to 2% of the balance
    # ($200 early), so it actually pays down.
    flat = debt_plan.simulate_strategy([_loan(schedule_kind="amortizing", rate="12", minimum="100")], Decimal("0"), "avalanche")
    revolving = debt_plan.simulate_strategy([_loan(schedule_kind="revolving", rate="12", minimum="100")], Decimal("0"), "avalanche")

    assert flat["payoff_date"] is None  # flat min never clears
    assert flat["months"] == debt_plan._MONTH_CAP
    assert revolving["payoff_date"] is not None
    assert 0 < revolving["months"] < debt_plan._MONTH_CAP


def test_promo_apr_reranks_avalanche_target():
    far = date.today() + timedelta(days=365 * 5)
    # A: nominally the highest APR (30%) but on a 0% intro promo for years.
    # B: 20% with no promo. Avalanche should fund B first while A's promo is active.
    a = _loan(name="A", schedule_kind="revolving", principal="5000", rate="30", minimum="100", promo_rate="0", promo_expiry_date=far)
    b = _loan(name="B", schedule_kind="revolving", principal="5000", rate="20", minimum="100")

    sim = debt_plan.simulate_strategy([a, b], Decimal("400"), "avalanche")
    first = {t["loan_id"]: t["extra_start_month"] for t in sim["timeline"]}
    assert first[b.id] == 1  # B (20%, no promo) receives the extra first
    assert first[a.id] == 0 or first[a.id] > first[b.id]

    # Without the promo, the 30% card would be funded first — proves re-ranking flipped it.
    a_no_promo = _loan(name="A", schedule_kind="revolving", principal="5000", rate="30", minimum="100")
    sim2 = debt_plan.simulate_strategy([a_no_promo, b], Decimal("400"), "avalanche")
    first2 = {t["loan_id"]: t["extra_start_month"] for t in sim2["timeline"]}
    assert first2[a_no_promo.id] == 1


def test_projected_spend_slows_payoff():
    base = debt_plan.simulate_strategy([_loan(schedule_kind="revolving", rate="12", minimum="300")], Decimal("100"), "avalanche")
    with_spend = debt_plan.simulate_strategy(
        [_loan(schedule_kind="revolving", rate="12", minimum="300", projected_monthly_spend="150")],
        Decimal("100"),
        "avalanche",
    )
    assert with_spend["months"] > base["months"]


def test_projected_spend_ignored_for_non_revolving():
    # projected_monthly_spend only applies to revolving cards; an amortizing loan
    # ignores it, so the payoff is identical with or without it.
    plain = debt_plan.simulate_strategy([_loan(schedule_kind="amortizing", rate="8", minimum="300")], Decimal("0"), "avalanche")
    with_spend = debt_plan.simulate_strategy(
        [_loan(schedule_kind="amortizing", rate="8", minimum="300", projected_monthly_spend="500")],
        Decimal("0"),
        "avalanche",
    )
    assert plain["months"] == with_spend["months"]
    assert plain["interest"] == with_spend["interest"]


def test_base_currency_min_override_is_used():
    # The assembly layer converts the minimum to base currency and attaches it as
    # min_amount_base; the sim must prefer it over the raw nominal minimum.
    loan = _loan(schedule_kind="amortizing", rate="0", minimum="100", outstanding="1200")
    loan.min_amount_base = Decimal("600")  # e.g. converted from a strong foreign currency
    sim = debt_plan.simulate_strategy([loan], Decimal("0"), "avalanche")
    # At 0% interest, 1200 / 600 = 2 months. With the nominal 100 it would take 12.
    assert sim["months"] == 2
