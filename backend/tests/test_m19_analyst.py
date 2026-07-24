from __future__ import annotations

from app.analyst.schemas import ACTION_TYPES, AnalystAction, AnalystAlert, AnalystAskIn, FinancialSnapshot
from app.analyst.service import build_messages, derive_alerts
from app.analyst import service as analyst_service
from app.llm.errors import LLMError
import pytest
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from types import SimpleNamespace


def _snapshot(**overrides) -> FinancialSnapshot:
    values = {
        "currency": "USD",
        "income": 5000.0,
        "expenses": 4000.0,
        "net": 1000.0,
        "net_worth": 20000.0,
        "assets": 30000.0,
        "liabilities": 10000.0,
    }
    values.update(overrides)
    return FinancialSnapshot(**values)


def test_action_types_allowlist():
    assert ACTION_TYPES == frozenset(
        {"create_widget", "open_personalize", "focus_widget", "set_budget", "snooze_alert", "dismiss_alert"}
    )


def test_alert_defaults_and_action_optional():
    alert = AnalystAlert(
        id="budget:abc", kind="budget_overspend", severity=9, tone="danger",
        title="Dining over", detail="Over by $40",
    )
    assert alert.suggested_action is None
    assert AnalystAction(type="set_budget", label="Raise budget").type == "set_budget"


def test_ask_in_requires_mode_and_question():
    assert AnalystAskIn(mode="explain", question="why?").range_from is None


def test_derive_alerts_budget_overage_is_danger():
    alerts = derive_alerts(_snapshot(budget_overages=[
        {"category_id": "c1", "name": "Dining", "over": 40.0, "pct": 140.0}
    ]))
    assert alerts[0].tone == "danger"
    assert alerts[0].suggested_action.type == "set_budget"


def test_derive_alerts_negative_cashflow_and_sorting():
    alerts = derive_alerts(_snapshot(income=3000, expenses=4200, net=-1200))
    assert any(alert.kind == "negative_cashflow" for alert in alerts)
    assert alerts == sorted(alerts, key=lambda alert: alert.severity, reverse=True)


def test_derive_alerts_all_clear():
    alerts = derive_alerts(_snapshot())
    assert len(alerts) == 1
    assert alerts[0].tone == "positive"


def test_build_messages_contains_mode_question_and_snapshot():
    messages = build_messages(
        "explain",
        _snapshot(period_from="2026-01-01", period_to="2026-03-31", period_days=90),
        "why did spend rise?",
    )
    assert messages[0]["role"] == "system"
    assert "explain" in messages[0]["content"].lower()
    assert "why did spend rise?" in messages[1]["content"]
    assert "20000" in messages[1]["content"]
    assert "not annual figures" in messages[0]["content"]
    assert '"period_from":"2026-01-01"' in messages[1]["content"]


def test_analyst_routes_registered():
    from app.main import app

    paths = {route.path for route in app.routes}
    assert {"/analyst/monitor", "/analyst/ask"} <= paths


class FakeLLM:
    def __init__(self, unavailable: bool = False):
        self.unavailable = unavailable

    async def chat(self, messages, **kwargs):
        if self.unavailable:
            raise LLMError("no provider")
        return {"content": "Because dining rose 38%."}


@pytest.mark.asyncio
async def test_run_ask_answers_and_degrades(monkeypatch):
    from app.analyst.memory.assembler import AssembledContext

    async def fake_assemble(*args, **kwargs):
        return AssembledContext(snapshot=_snapshot().model_dump(), chunks=[], facts=[])

    monkeypatch.setattr(analyst_service, "assemble", fake_assemble)
    user = SimpleNamespace(id="user-id")
    data = AnalystAskIn(mode="explain", question="why?")
    answer = await analyst_service.run_ask(None, user, data, FakeLLM())
    unavailable = await analyst_service.run_ask(None, user, data, FakeLLM(unavailable=True))
    assert answer.available is True and "dining" in answer.answer.lower()
    assert unavailable.available is False and unavailable.suggestions == []


@pytest.mark.asyncio
async def test_run_ask_handles_greeting_without_snapshot_or_llm(monkeypatch):
    async def unexpected_snapshot(*args, **kwargs):
        raise AssertionError("greetings must not build a financial snapshot")

    class UnexpectedLLM:
        async def chat(self, *args, **kwargs):
            raise AssertionError("greetings must not call the LLM")

    monkeypatch.setattr(analyst_service, "build_snapshot", unexpected_snapshot)
    monkeypatch.setattr(analyst_service, "assemble", unexpected_snapshot)
    result = await analyst_service.run_ask(
        None,
        SimpleNamespace(id="user-id"),
        AnalystAskIn(mode="explain", question="hi!"),
        UnexpectedLLM(),
    )
    assert result.answer.startswith("Hi —")


@pytest.mark.asyncio
async def test_build_snapshot_includes_loans(monkeypatch):
    from app.analyst import snapshot as snapshot_mod

    async def fake_list_loans(session, user):
        return [{
            "name": "Home Loan", "type": "home", "schedule_kind": "emi",
            "outstanding_balance": 450000, "principal": 500000,
            "interest_rate": 6.5, "min_or_emi_amount": 2840, "next_due_date": "2024-06-01",
        }]

    # Neutralize the other analytics calls build_snapshot makes.
    monkeypatch.setattr(snapshot_mod.analytics, "summary", lambda *a, **k: _async({"rows": []}))
    monkeypatch.setattr(snapshot_mod.analytics, "timeseries", lambda *a, **k: _async({"points": []}))
    monkeypatch.setattr(snapshot_mod.analytics, "breakdown", lambda *a, **k: _async({"rows": []}))
    monkeypatch.setattr(snapshot_mod.analytics, "net_worth", lambda *a, **k: _async({"currency": "USD"}))
    monkeypatch.setattr(snapshot_mod.analytics, "list_budgets", lambda *a, **k: _async([]))
    monkeypatch.setattr(snapshot_mod.analytics, "recommendations", lambda *a, **k: _async([]))
    monkeypatch.setattr(snapshot_mod.widgets, "list_recurring", lambda *a, **k: _async([]))
    monkeypatch.setattr(snapshot_mod.widgets, "list_credit_cards", lambda *a, **k: _async([]))
    monkeypatch.setattr(snapshot_mod.loans_service, "list_loans", fake_list_loans)
    monkeypatch.setattr(snapshot_mod.widgets, "list_holdings", lambda *a, **k: _async([]))
    monkeypatch.setattr(snapshot_mod.income, "list_income_sources", lambda *a, **k: _async([]))

    snap = await snapshot_mod.build_snapshot(None, SimpleNamespace(id="u"), date(2024, 1, 1), date(2024, 1, 31))
    assert snap.loans and snap.loans[0]["name"] == "Home Loan"
    assert snap.loans[0]["outstanding"] == 450000.0
    assert snap.loans[0]["monthly"] == 2840.0


@pytest.mark.asyncio
async def test_build_snapshot_uses_timeseries_cashflow_signs(monkeypatch):
    from app.analyst import snapshot as snapshot_mod

    monkeypatch.setattr(snapshot_mod.analytics, "summary", lambda *a, **k: _async({"comparison": {}}))
    monkeypatch.setattr(
        snapshot_mod.analytics,
        "timeseries",
        lambda *a, **k: _async({"points": [{"period": "2026-06", "income": Decimal("5000"), "spend": Decimal("3200"), "net": Decimal("1800")}]}),
    )
    monkeypatch.setattr(snapshot_mod.analytics, "breakdown", lambda *a, **k: _async({"rows": []}))
    monkeypatch.setattr(snapshot_mod.analytics, "net_worth", lambda *a, **k: _async({"currency": "USD"}))
    monkeypatch.setattr(snapshot_mod.analytics, "list_budgets", lambda *a, **k: _async([]))
    monkeypatch.setattr(snapshot_mod.analytics, "recommendations", lambda *a, **k: _async([]))
    monkeypatch.setattr(snapshot_mod.widgets, "list_recurring", lambda *a, **k: _async([]))
    monkeypatch.setattr(snapshot_mod.widgets, "list_credit_cards", lambda *a, **k: _async([]))
    monkeypatch.setattr(snapshot_mod.loans_service, "list_loans", lambda *a, **k: _async([]))
    monkeypatch.setattr(snapshot_mod.widgets, "list_holdings", lambda *a, **k: _async([]))
    monkeypatch.setattr(snapshot_mod.income, "list_income_sources", lambda *a, **k: _async([]))

    snap = await snapshot_mod.build_snapshot(None, SimpleNamespace(id="u"), date(2026, 6, 1), date(2026, 6, 30))
    alerts = derive_alerts(snap)

    assert snap.income == 5000.0
    assert snap.expenses == 3200.0
    assert snap.net == 1800.0
    assert all(alert.kind != "negative_cashflow" for alert in alerts)


def _async(value):
    async def _coro(*a, **k):
        return value
    return _coro()


def test_debt_plan_schemas_exist():
    from app.analyst.schemas import DebtPlanLLM, DebtPlanOut, DebtPlanOrderItem
    llm = DebtPlanLLM(strategy="avalanche", extra_monthly=600, headline="x", narrative="y")
    assert llm.strategy == "avalanche"
    out = DebtPlanOut(
        source="deterministic", strategy="avalanche", extra_monthly=Decimal("600"),
        headline="x", ordered=[], currency="USD", interest_saved=Decimal("0"),
        months_sooner=0, baseline_payoff_date=None, optimized_payoff_date=None,
        updated_at=datetime(2026, 6, 21, tzinfo=timezone.utc),
    )
    assert out.available is True and out.narrative == ""


@pytest.mark.asyncio
async def test_project_total_extra_reduces_interest_and_months():
    from app.analyst import debt_plan
    from app.models.debt import Loan
    loan = Loan(
        id=uuid.uuid4(), household_id=uuid.uuid4(), name="Card", type="credit_card",
        schedule_kind="amortizing", principal=Decimal("10000"), currency="USD",
        interest_rate=Decimal("18"), min_or_emi_amount=Decimal("300"),
        start_date=date(2024, 1, 1), due_day=1,
    )
    base = debt_plan.project_total([loan], Decimal("0"), "avalanche")
    boosted = debt_plan.project_total([loan], Decimal("200"), "avalanche")
    assert boosted["months"] < base["months"]
    assert boosted["interest"] < base["interest"]

    ordered = debt_plan.build_ordered([loan], Decimal("200"), "avalanche")
    assert ordered[0].extra_allocation == Decimal("200.00")
    assert ordered[0].impact == "Highest impact"


def _loan(name, outstanding, rate, minimum, **kw):
    from app.models.debt import Loan
    loan = Loan(
        id=uuid.uuid4(), household_id=uuid.uuid4(), name=name, type="personal",
        schedule_kind="amortizing", principal=Decimal(outstanding), currency="USD",
        interest_rate=(None if rate is None else Decimal(rate)),
        min_or_emi_amount=Decimal(minimum), start_date=date(2024, 1, 1), due_day=1,
    )
    loan.outstanding_balance = Decimal(outstanding)
    for k, v in kw.items():
        setattr(loan, k, v)
    return loan


def test_cascade_moves_payoff_when_targeting_nonhorizon_loan():
    # The classic bug: extra aimed at a small high-rate loan that is NOT the
    # longest loan used to leave the debt-free date unchanged. With rollover, the
    # freed minimum cascades into the horizon loan and the date moves.
    from app.analyst import debt_plan
    loans = [_loan("Card", "5000", "22", "150"), _loan("Home", "400000", "4", "1900")]
    base = debt_plan.project_total(loans, Decimal("0"), "avalanche")
    opt = debt_plan.project_total(loans, Decimal("50"), "avalanche")
    assert opt["months"] < base["months"]  # rollover accelerates the whole plan
    assert base["interest"] - opt["interest"] > Decimal("0")


def test_project_total_uses_outstanding_balance_not_principal():
    from app.analyst import debt_plan
    paid_down = _loan("Loan", "10000", "12", "300")
    paid_down.outstanding_balance = Decimal("2000")  # mostly repaid
    fresh = _loan("Loan", "10000", "12", "300")  # outstanding == principal
    assert debt_plan.project_total([paid_down], Decimal("0"), "avalanche")["months"] < \
        debt_plan.project_total([fresh], Decimal("0"), "avalanche")["months"]


def test_backend_matches_frontend_simulateStrategy():
    # Ground truth captured from the frontend simulateStrategy (debt-math.ts) on
    # the same fixture: card 5000@22 min150, auto 12000@7 min300, home 200000@4
    # min1200; avalanche. Both engines must agree to the cent so the card and the
    # chart never contradict each other.
    from app.analyst import debt_plan
    loans = [
        _loan("Card", "5000", "22", "150"),
        _loan("Auto", "12000", "7", "300"),
        _loan("Home", "200000", "4", "1200"),
    ]
    base = debt_plan.project_total(loans, Decimal("0"), "avalanche")
    opt = debt_plan.project_total(loans, Decimal("150"), "avalanche")
    assert base["months"] == 177 and base["interest"] == Decimal("74109.82")
    assert opt["months"] == 156 and opt["interest"] == Decimal("63324.78")


@pytest.mark.asyncio
async def test_run_debt_plan_ai_chooses_strategy_math_sets_numbers(monkeypatch):
    from app.analyst import service as svc
    from app.models.debt import Loan

    loans = [
        Loan(id=uuid.uuid4(), household_id=uuid.uuid4(), name="Card", type="credit_card",
             schedule_kind="amortizing", principal=Decimal("10000"), currency="USD",
             interest_rate=Decimal("18"), min_or_emi_amount=Decimal("300"),
             start_date=date(2024, 1, 1), due_day=1),
    ]

    async def fake_loans(session, user):
        return loans

    monkeypatch.setattr(svc, "_debt_loans", fake_loans)

    async def fake_cashflow(session, user):
        # Plenty of headroom so the AI's $200 is within budget and not clamped.
        return SimpleNamespace(income_monthly=Decimal("3000"), leftover_monthly=Decimal("800"))

    monkeypatch.setattr(svc, "build_cashflow_summary", fake_cashflow)

    class PlanLLM:
        async def chat(self, messages, **kwargs):
            # The model tries to inject a bogus saving; the service must ignore it.
            return {"strategy": "avalanche", "extra_monthly": 200,
                    "headline": "Hit the card hard", "narrative": "Because 18% APR.",
                    "interest_saved": 999999}

    out = await svc.run_debt_plan(None, SimpleNamespace(id="u"), PlanLLM())
    assert out.available is True and out.source == "ai"
    assert out.strategy == "avalanche" and out.extra_monthly == Decimal("200.00")
    assert out.headline == "Hit the card hard"
    assert out.ordered[0].impact == "Highest impact"
    # Number is computed, never the model's 999999.
    assert out.interest_saved != Decimal("999999")
    assert out.months_sooner >= 0


@pytest.mark.asyncio
async def test_run_debt_plan_degrades_to_deterministic(monkeypatch):
    from app.analyst import service as svc
    from app.llm.errors import LLMError
    from app.models.debt import Loan

    loans = [Loan(id=uuid.uuid4(), household_id=uuid.uuid4(), name="Card", type="credit_card",
                  schedule_kind="amortizing", principal=Decimal("10000"), currency="USD",
                  interest_rate=Decimal("18"), min_or_emi_amount=Decimal("300"),
                  start_date=date(2024, 1, 1), due_day=1)]

    async def fake_loans(session, user):
        return loans

    monkeypatch.setattr(svc, "_debt_loans", fake_loans)

    class DownLLM:
        async def chat(self, *a, **k):
            raise LLMError("no provider")

    out = await svc.run_debt_plan(None, SimpleNamespace(id="u"), DownLLM())
    assert out.available is False and out.source == "deterministic"
    assert out.strategy in {"snowball", "avalanche"} and out.ordered


@pytest.mark.asyncio
async def test_run_debt_plan_caps_extra_when_cashflow_unavailable(monkeypatch):
    # Guardrail-gap regression: if cashflow can't be computed, a hallucinated LLM
    # number must NOT pass through unbounded — it's capped at the deterministic
    # affordable default instead.
    from app.analyst import service as svc

    loans = [_loan("Card", "10000", "18", "300")]

    async def fake_loans(session, user):
        return loans

    monkeypatch.setattr(svc, "_debt_loans", fake_loans)

    async def boom(session, user):
        raise RuntimeError("no cashflow")

    monkeypatch.setattr(svc, "build_cashflow_summary", boom)

    class GreedyLLM:
        async def chat(self, messages, **kwargs):
            return {"strategy": "avalanche", "extra_monthly": 999999,
                    "headline": "Pay it all", "narrative": "now"}

    out = await svc.run_debt_plan(None, SimpleNamespace(id="u"), GreedyLLM())
    cap = svc._deterministic_extra(loans, Decimal("0"))
    assert out.extra_monthly == cap
    assert out.extra_monthly < Decimal("999999")


@pytest.mark.asyncio
async def test_run_debt_plan_allows_extra_above_old_10k_cap(monkeypatch):
    # The flat $10k cap is removed: with enough affordable leftover, a large extra
    # flows through, bounded only by affordability.
    from app.analyst import service as svc

    loans = [_loan("Home", "400000", "5", "1900")]

    async def fake_loans(session, user):
        return loans

    async def fake_cashflow(session, user):
        return SimpleNamespace(income_monthly=Decimal("70000"), leftover_monthly=Decimal("50000"))

    monkeypatch.setattr(svc, "_debt_loans", fake_loans)
    monkeypatch.setattr(svc, "build_cashflow_summary", fake_cashflow)

    class PlanLLM:
        async def chat(self, messages, **kwargs):
            return {"strategy": "avalanche", "extra_monthly": 25000, "headline": "h", "narrative": "n"}

    out = await svc.run_debt_plan(None, SimpleNamespace(id="u", household_id=uuid.uuid4()), PlanLLM())
    assert out.extra_monthly == Decimal("25000.00")  # would have been clamped to 10000 before


@pytest.mark.asyncio
async def test_run_debt_plan_force_bypasses_cache(monkeypatch):
    # force=True must recompute (and re-hit the LLM) even when a cached plan exists.
    from app.analyst import service as svc
    from app.llm.cache import LLMCache

    loans = [_loan("Card", "10000", "18", "300")]

    async def fake_loans(session, user):
        return loans

    async def fake_cashflow(session, user):
        return SimpleNamespace(income_monthly=Decimal("4000"), leftover_monthly=Decimal("600"))

    monkeypatch.setattr(svc, "_debt_loans", fake_loans)
    monkeypatch.setattr(svc, "build_cashflow_summary", fake_cashflow)

    class _Redis:
        def __init__(self):
            self.store = {}

        async def get(self, k):
            return self.store.get(k)

        async def set(self, k, v, ex=None):
            self.store[k] = v

    class CountingLLM:
        def __init__(self):
            self.calls = 0
            self.cache = LLMCache(_Redis(), enabled=True, ttl_seconds=86400)

        async def chat(self, messages, **kwargs):
            self.calls += 1
            return {"strategy": "avalanche", "extra_monthly": 100, "headline": "h", "narrative": "n"}

    llm = CountingLLM()
    user = SimpleNamespace(id="u", household_id=uuid.uuid4())

    await svc.run_debt_plan(None, user, llm)
    await svc.run_debt_plan(None, user, llm)  # cached
    assert llm.calls == 1
    await svc.run_debt_plan(None, user, llm, force=True)  # manual recalc
    assert llm.calls == 2


@pytest.mark.asyncio
async def test_run_debt_plan_caches_until_inputs_change(monkeypatch):
    # A refresh must reuse the cached plan (no recompute, no second LLM hit); a
    # change to the loans must invalidate it via the input fingerprint.
    from app.analyst import service as svc
    from app.llm.cache import LLMCache

    loan = _loan("Card", "10000", "18", "300")
    loans = [loan]

    async def fake_loans(session, user):
        return loans

    async def fake_cashflow(session, user):
        return SimpleNamespace(income_monthly=Decimal("4000"), leftover_monthly=Decimal("600"))

    monkeypatch.setattr(svc, "_debt_loans", fake_loans)
    monkeypatch.setattr(svc, "build_cashflow_summary", fake_cashflow)

    class _Redis:
        def __init__(self):
            self.store = {}

        async def get(self, k):
            return self.store.get(k)

        async def set(self, k, v, ex=None):
            self.store[k] = v

    class CountingLLM:
        def __init__(self):
            self.calls = 0
            self.cache = LLMCache(_Redis(), enabled=True, ttl_seconds=86400)

        async def chat(self, messages, **kwargs):
            self.calls += 1
            return {"strategy": "avalanche", "extra_monthly": 100, "headline": "h", "narrative": "n"}

    llm = CountingLLM()
    user = SimpleNamespace(id="u", household_id=uuid.uuid4())

    await svc.run_debt_plan(None, user, llm)
    cached = await svc.run_debt_plan(None, user, llm)
    assert llm.calls == 1  # second refresh served from cache
    assert cached.source == "ai" and cached.extra_monthly == Decimal("100.00")

    loan.outstanding_balance = Decimal("5000")  # an input changed
    await svc.run_debt_plan(None, user, llm)
    assert llm.calls == 2  # fingerprint flipped -> recompute


@pytest.mark.asyncio
async def test_run_debt_plan_no_loans(monkeypatch):
    from app.analyst import service as svc

    async def no_loans(session, user):
        return []

    monkeypatch.setattr(svc, "_debt_loans", no_loans)

    class AnyLLM:
        async def chat(self, *a, **k):
            raise AssertionError("must not call LLM with no loans")

    out = await svc.run_debt_plan(None, SimpleNamespace(id="u"), AnyLLM())
    assert out.ordered == [] and out.interest_saved == Decimal("0.00")


@pytest.mark.asyncio
async def test_debt_loans_excludes_credit_cards():
    from app.analyst import service as svc
    from app.models.debt import Loan

    rows = [
        Loan(id=uuid.uuid4(), household_id=uuid.uuid4(), name="Visa", type="credit_card",
             schedule_kind="amortizing", principal=Decimal("5000"), currency="USD",
             interest_rate=Decimal("22"), min_or_emi_amount=Decimal("150"),
             start_date=date(2024, 1, 1), due_day=1),
        Loan(id=uuid.uuid4(), household_id=uuid.uuid4(), name="Auto", type="auto",
             schedule_kind="amortizing", principal=Decimal("12000"), currency="USD",
             interest_rate=Decimal("6"), min_or_emi_amount=Decimal("250"),
             start_date=date(2024, 1, 1), due_day=1),
    ]

    class _Scalars:
        def __init__(self, items):
            self._items = items

        def scalars(self):
            return self

        def all(self):
            return self._items

    class _Session:
        def __init__(self):
            self._calls = 0

        async def execute(self, _query):
            # First call lists loans; subsequent calls are per-loan payment lookups.
            self._calls += 1
            return _Scalars(rows if self._calls == 1 else [])

        async def get(self, _model, _pk):
            # Household lookup for base currency; None -> defaults to USD (no FX).
            return None

    kept = await svc._debt_loans(
        _Session(), SimpleNamespace(id="u", household_id=uuid.uuid4())
    )
    assert [loan.name for loan in kept] == ["Auto"]


def test_debt_plan_route_registered():
    from app.main import app
    paths = {route.path for route in app.routes}
    assert "/analyst/debt-plan" in paths


from decimal import Decimal as D

from app.analyst.service import _affordable_default_extra


def test_affordable_default_extra_is_half_leftover():
    assert _affordable_default_extra(D("1000")) == D("500.00")
    assert _affordable_default_extra(D("-50")) == D("0.00")
    # No upper cap any more: it scales with leftover.
    assert _affordable_default_extra(D("40000")) == D("20000.00")


@pytest.mark.asyncio
async def test_run_debt_plan_explicit_aggression_uses_engine_amount(monkeypatch):
    from app.analyst import service as svc

    loans = [_loan("Card", "10000", "18", "300"), _loan("Auto", "12000", "7", "300")]

    async def fake_loans(session, user):
        return loans

    async def fake_cashflow(session, user):
        return SimpleNamespace(income_monthly=Decimal("5000"), leftover_monthly=Decimal("1000"))

    monkeypatch.setattr(svc, "_debt_loans", fake_loans)
    monkeypatch.setattr(svc, "build_cashflow_summary", fake_cashflow)

    class IgnoredLLM:
        async def chat(self, *args, **kwargs):
            raise AssertionError("explicit aggression plans are computed, not guessed by the LLM")

    out = await svc.run_debt_plan(
        None, SimpleNamespace(id="u", household_id=uuid.uuid4()), IgnoredLLM(),
        aggression_level="aggressive",
    )
    assert out.source == "ai"
    assert out.aggression_level == "aggressive"
    assert out.extra_monthly == Decimal("750.00")
    assert out.milestones.monthly_cash_still_left == Decimal("250.00")
    assert out.ordered[0].name == "Card"
    assert out.phases
    assert len(out.alternatives) == 4
    assert "USD 750.00/month" in out.final_recommendation


def test_order_loans_avalanche_tiebreaks_small_balance():
    from app.analyst import debt_plan

    loans = [_loan("Large", "10000", "18", "300"), _loan("Small", "500", "18", "50")]
    assert [loan.name for loan in debt_plan.order_loans(loans, "avalanche")] == ["Small", "Large"]


def test_build_messages_includes_focus_block():
    snap = _snapshot()
    msgs = build_messages(
        "explain", snap, "why the jump?",
        focus={"kind": "merchant", "label": "Home Depot", "spend": 18130.95, "prev_spend": 12000.0, "delta_pct": 51.1},
    )
    assert any("Home Depot" in m["content"] for m in msgs)


def test_build_messages_without_focus_is_unchanged():
    snap = _snapshot()
    msgs = build_messages("explain", snap, "why?")
    assert not any("currently viewing" in m["content"] for m in msgs)


def test_ask_in_accepts_optional_focus():
    data = AnalystAskIn(mode="explain", question="x", focus_kind="category", focus_label="Travel", focus_id="c1")
    assert data.focus_kind == "category"
    assert AnalystAskIn(mode="explain", question="x").focus_kind is None


def test_build_messages_includes_page_context():
    msgs = build_messages("explain", _snapshot(), "what's up?", page="Spend")
    assert any("Spend page" in m["content"] for m in msgs)


def test_ask_in_accepts_optional_page():
    assert AnalystAskIn(mode="explain", question="x", page="Debt").page == "Debt"
    assert AnalystAskIn(mode="explain", question="x").page is None


def test_grounding_rules_mention_unknown_data():
    from app.analyst.service import _GROUNDING_RULES
    assert "don't" in _GROUNDING_RULES.lower() or "do not" in _GROUNDING_RULES.lower()


def test_ask_out_carries_citations():
    from app.analyst.schemas import AnalystAskOut
    out = AnalystAskOut(answer="ok", citations=[{"source_type": "transaction", "source_id": "x"}])
    assert out.citations[0]["source_type"] == "transaction"


def test_persistent_alert_schema_and_monitor_shape():
    from app.analyst.schemas import MonitorOut, PersistentAlert
    a = PersistentAlert(id="x", kind="insight", severity=5, tone="info", state="active",
                        title="t", detail="d")
    out = MonitorOut(alerts=[a])
    assert out.alerts[0].state == "active"


def test_acknowledge_route_registered():
    from app.analyst.router import router
    paths = {route.path for route in router.routes}
    assert "/analyst/alerts/{alert_id}/acknowledge" in paths
    assert "/analyst/scan" in paths
