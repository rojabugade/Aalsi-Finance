# Slice G — AI Analyst Pane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an AI Analyst as a floating pane opened by an always-present bottom-right "blob" (FAB), working over the household's own financial data with four real modes — Monitor, Explain, Plan, Action.

**Architecture:** A new backend `app/analyst` module assembles a compact financial snapshot (reusing `analytics`/`widget_data` services) and exposes `GET /analyst/monitor` (deterministic alerts, no LLM) and `POST /analyst/ask` (mode-aware, calls the M3 LLM gateway, degrades gracefully with no provider key). A new frontend `components/dashboard/analyst/` tree renders the blob + true floating glass pane with the four modes, talking to the endpoints via typed TanStack hooks. The old toolbar Analyst toggle is removed.

**Tech Stack:** FastAPI + SQLAlchemy async + Pydantic (backend), pytest; Next.js + React + TanStack Query + `openapi-fetch` + Tailwind (frontend), Vitest + Playwright.

## Global Constraints

- Backend modules are household-scoped via `scoped_query`; all endpoints depend on `get_current_user` (label: `purpose="analyst.<x>"` for LLM usage logging).
- LLM access is the **internal Python API only**: `await llm.chat(messages, *, json_schema=None, purpose=..., user_id=..., session=..., use_cache=...)` returns `{"content": str, "tool_calls": ...}` or validated dict when `json_schema` set. Get it via `Depends(get_llm_client)`.
- `Settings.llm_api_key` defaults to `""`. When unset or the provider errors, `llm.chat` raises `LLMError` — the analyst MUST catch it and return `available=False`, never 5xx.
- Reuse existing aggregates — do NOT recompute: `app.analytics.service.{summary,breakdown,net_worth,list_budgets,recommendations}`, `app.widget_data.service.{list_credit_cards,list_recurring,list_holdings}`.
- Date params follow the analytics convention: query aliases `from`/`to` as ISO dates. Frontend computes them with `presetRange(preset)` → `{ from, to }` from `@/lib/dates`.
- Frontend data access: typed `api` client from `web/lib/api/client.ts`, `unwrap()` helper pattern (see `web/lib/api/guidance.ts`). New endpoints require regenerating `shared/api-schema.ts` via `npm run gen:api` (needs the API running on :8000).
- Verify with `tsc --noEmit`, `vitest run`, `playwright test` (NOT `next lint` — broken in this repo) and backend `pytest` (run in the api container; local `.venv` is broken). Tests skip gracefully when Postgres at `TEST_DATABASE_URL` is unreachable (mirror `tests/test_m10_guidance.py`).
- Privacy: wrap monetary values shown in Monitor cards in `<Private>` (`@/components/dashboard/privacy-provider`).

---

## Phase 1 — Backend `app/analyst`

### Task 1: Analyst schemas

**Files:**
- Create: `backend/app/analyst/__init__.py` (empty)
- Create: `backend/app/analyst/schemas.py`
- Test: `backend/tests/test_m19_analyst.py`

**Interfaces:**
- Produces: Pydantic models `AnalystAlert`, `AnalystAction`, `MonitorOut`, `AnalystAskIn`, `AnalystAskOut`, `FinancialSnapshot`, `AnalystActionResponse`, and the `ACTION_TYPES` frozenset.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_m19_analyst.py
from __future__ import annotations

from app.analyst.schemas import (
    ACTION_TYPES,
    AnalystAction,
    AnalystAlert,
    AnalystAskIn,
)


def test_action_types_allowlist():
    assert ACTION_TYPES == frozenset(
        {"create_widget", "open_personalize", "focus_widget", "set_budget", "snooze_alert", "dismiss_alert"}
    )


def test_alert_defaults_and_action_optional():
    alert = AnalystAlert(id="budget:abc", kind="budget_overspend", severity=9, tone="danger", title="Dining over", detail="Over by $40")
    assert alert.suggested_action is None
    action = AnalystAction(type="set_budget", label="Raise dining budget", params={"category_id": "x"})
    assert action.type == "set_budget"


def test_ask_in_requires_mode_and_question():
    data = AnalystAskIn(mode="explain", question="why?")
    assert data.range_from is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_m19_analyst.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.analyst'`

- [ ] **Step 3: Write minimal implementation**

```python
# backend/app/analyst/__init__.py
```

```python
# backend/app/analyst/schemas.py
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Tone = Literal["positive", "info", "warning", "danger"]
Mode = Literal["explain", "plan", "action"]

ACTION_TYPES = frozenset(
    {"create_widget", "open_personalize", "focus_widget", "set_budget", "snooze_alert", "dismiss_alert"}
)


class AnalystAction(BaseModel):
    type: str
    label: str
    params: dict = Field(default_factory=dict)


class AnalystAlert(BaseModel):
    id: str
    kind: str
    severity: int  # 0-10
    tone: Tone
    title: str
    detail: str
    suggested_action: AnalystAction | None = None


class MonitorOut(BaseModel):
    alerts: list[AnalystAlert]


class AnalystAskIn(BaseModel):
    mode: Mode
    question: str
    range_from: str | None = None
    range_to: str | None = None


class AnalystAskOut(BaseModel):
    answer: str
    suggestions: list[AnalystAction] = Field(default_factory=list)
    available: bool = True


class AnalystActionResponse(BaseModel):
    """Schema the LLM fills for action mode (validated by the gateway)."""

    answer: str
    actions: list[AnalystAction] = Field(default_factory=list)


class FinancialSnapshot(BaseModel):
    currency: str
    income: float
    expenses: float
    net: float
    net_delta_pct: float | None = None
    net_worth: float
    assets: float
    liabilities: float
    budget_overages: list[dict] = Field(default_factory=list)
    near_limit_budgets: list[dict] = Field(default_factory=list)
    top_categories: list[dict] = Field(default_factory=list)
    upcoming_recurring: list[dict] = Field(default_factory=list)
    recurring_monthly_total: float = 0.0
    credit_cards: list[dict] = Field(default_factory=list)
    recommendations: list[dict] = Field(default_factory=list)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_m19_analyst.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/app/analyst/__init__.py backend/app/analyst/schemas.py backend/tests/test_m19_analyst.py
git commit -m "feat(analyst): slice G schemas (alerts, actions, snapshot)"
```

---

### Task 2: Monitor alert derivation (pure)

**Files:**
- Create: `backend/app/analyst/service.py`
- Test: `backend/tests/test_m19_analyst.py` (append)

**Interfaces:**
- Consumes: `FinancialSnapshot`, `AnalystAlert`, `AnalystAction` from Task 1.
- Produces: `derive_alerts(snapshot: FinancialSnapshot) -> list[AnalystAlert]` — pure, severity-sorted desc.

- [ ] **Step 1: Write the failing test (append)**

```python
# backend/tests/test_m19_analyst.py (append)
from app.analyst.schemas import FinancialSnapshot
from app.analyst.service import derive_alerts


def _snap(**kw) -> FinancialSnapshot:
    base = dict(currency="USD", income=5000.0, expenses=4000.0, net=1000.0, net_worth=20000.0, assets=30000.0, liabilities=10000.0)
    base.update(kw)
    return FinancialSnapshot(**base)


def test_derive_alerts_flags_budget_overage_as_danger():
    snap = _snap(budget_overages=[{"category_id": "c1", "name": "Dining", "over": 40.0, "pct": 140.0}])
    alerts = derive_alerts(snap)
    top = alerts[0]
    assert top.tone == "danger"
    assert top.suggested_action is not None
    assert top.suggested_action.type == "set_budget"


def test_derive_alerts_negative_net_is_warning_and_sorted_first_when_no_overage():
    snap = _snap(income=3000.0, expenses=4200.0, net=-1200.0)
    alerts = derive_alerts(snap)
    assert any(a.kind == "negative_cashflow" and a.tone == "warning" for a in alerts)
    assert alerts == sorted(alerts, key=lambda a: a.severity, reverse=True)


def test_derive_alerts_all_clear_returns_positive():
    alerts = derive_alerts(_snap())
    assert len(alerts) == 1 and alerts[0].tone == "positive"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_m19_analyst.py -v`
Expected: FAIL — `ImportError: cannot import name 'derive_alerts'`

- [ ] **Step 3: Write minimal implementation**

```python
# backend/app/analyst/service.py
from __future__ import annotations

from app.analyst.schemas import AnalystAction, AnalystAlert, FinancialSnapshot


def derive_alerts(snapshot: FinancialSnapshot) -> list[AnalystAlert]:
    alerts: list[AnalystAlert] = []

    for b in snapshot.budget_overages:
        alerts.append(
            AnalystAlert(
                id=f"budget:{b.get('category_id')}",
                kind="budget_overspend",
                severity=9,
                tone="danger",
                title=f"{b.get('name', 'A budget')} is over",
                detail=f"Over by {snapshot.currency} {b.get('over', 0):.0f} ({b.get('pct', 0):.0f}% of limit).",
                suggested_action=AnalystAction(
                    type="set_budget",
                    label=f"Adjust {b.get('name', 'budget')}",
                    params={"category_id": b.get("category_id")},
                ),
            )
        )

    if snapshot.net < 0:
        alerts.append(
            AnalystAlert(
                id="cashflow:negative",
                kind="negative_cashflow",
                severity=8,
                tone="warning",
                title="Cash flow is negative",
                detail=f"Spending exceeds income by {snapshot.currency} {abs(snapshot.net):.0f} this period.",
                suggested_action=AnalystAction(type="focus_widget", label="View cashflow", params={"widget": "cashflow"}),
            )
        )

    for b in snapshot.near_limit_budgets:
        alerts.append(
            AnalystAlert(
                id=f"budget-near:{b.get('category_id')}",
                kind="budget_near_limit",
                severity=5,
                tone="info",
                title=f"{b.get('name', 'A budget')} near its limit",
                detail=f"{b.get('pct', 0):.0f}% of the limit used.",
            )
        )

    for r in snapshot.recommendations:
        alerts.append(
            AnalystAlert(
                id=f"rec:{r.get('id')}",
                kind=str(r.get("type", "recommendation")),
                severity=6,
                tone="info",
                title="Heads up",
                detail=str(r.get("message", "Review this recommendation.")),
            )
        )

    if not alerts:
        alerts.append(
            AnalystAlert(id="all-clear", kind="all_clear", severity=1, tone="positive", title="All clear", detail="Nothing needs your attention right now.")
        )

    alerts.sort(key=lambda a: a.severity, reverse=True)
    return alerts
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_m19_analyst.py -v`
Expected: PASS (6 tests total)

- [ ] **Step 5: Commit**

```bash
git add backend/app/analyst/service.py backend/tests/test_m19_analyst.py
git commit -m "feat(analyst): deterministic monitor alert derivation"
```

---

### Task 3: Mode prompt builder (pure)

**Files:**
- Modify: `backend/app/analyst/service.py`
- Test: `backend/tests/test_m19_analyst.py` (append)

**Interfaces:**
- Consumes: `FinancialSnapshot`, `Mode` from Task 1.
- Produces: `build_messages(mode: str, snapshot: FinancialSnapshot, question: str) -> list[dict]`.

- [ ] **Step 1: Write the failing test (append)**

```python
# backend/tests/test_m19_analyst.py (append)
from app.analyst.service import build_messages


def test_build_messages_has_system_and_user_with_snapshot_and_mode():
    snap = _snap()
    msgs = build_messages("explain", snap, "why did spend rise?")
    assert msgs[0]["role"] == "system"
    assert "explain" in msgs[0]["content"].lower()
    assert "why did spend rise?" in msgs[1]["content"]
    assert "20000" in msgs[1]["content"]  # net worth from the snapshot JSON


def test_build_messages_action_mode_requests_structured_actions():
    msgs = build_messages("action", _snap(), "set a dining budget")
    assert "action" in msgs[0]["content"].lower()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_m19_analyst.py::test_build_messages_has_system_and_user_with_snapshot_and_mode -v`
Expected: FAIL — `ImportError: cannot import name 'build_messages'`

- [ ] **Step 3: Write minimal implementation (append to service.py)**

```python
# backend/app/analyst/service.py (append)
_SYSTEM = {
    "explain": (
        "You are a personal-finance analyst. EXPLAIN why the user's metrics changed, "
        "grounded ONLY in the provided JSON snapshot of their finances. Be concise and specific. "
        "Do not invent numbers that are not in the snapshot."
    ),
    "plan": (
        "You are a personal-finance analyst in PLAN mode. Produce a short, actionable plan "
        "(budgeting, debt payoff, or savings) using only the provided JSON snapshot. "
        "Prefer concrete steps with the user's real numbers."
    ),
    "action": (
        "You are a personal-finance analyst in ACTION mode. Answer briefly, then propose concrete "
        "actions the user can confirm. Each action has a `type` from this allow-list: "
        "create_widget, open_personalize, focus_widget, set_budget. Use only data from the snapshot."
    ),
}


def build_messages(mode: str, snapshot: FinancialSnapshot, question: str) -> list[dict]:
    system = _SYSTEM.get(mode, _SYSTEM["explain"])
    snapshot_json = snapshot.model_dump_json()
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": f"Question: {question}\n\nFinancial snapshot (JSON):\n{snapshot_json}"},
    ]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_m19_analyst.py -v`
Expected: PASS (8 tests total)

- [ ] **Step 5: Commit**

```bash
git add backend/app/analyst/service.py backend/tests/test_m19_analyst.py
git commit -m "feat(analyst): mode-specific prompt builder"
```

---

### Task 4: Snapshot builder (DB)

**Files:**
- Create: `backend/app/analyst/snapshot.py`
- Test: `backend/tests/test_m19_analyst.py` (append)

**Interfaces:**
- Consumes: `app.analytics.service`, `app.widget_data.service`, `FinancialSnapshot`.
- Produces: `async build_snapshot(session, user, from_date: date, to_date: date) -> FinancialSnapshot`.

- [ ] **Step 1: Write the failing test (append)**

This test seeds a household + one over-limit budget and asserts the snapshot reflects it. It skips when Postgres is unreachable (mirror `test_m10_guidance.py`).

```python
# backend/tests/test_m19_analyst.py (append)
import os
import uuid as _uuid
from datetime import date, timedelta
from decimal import Decimal

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.analyst.snapshot import build_snapshot
from app.models.core import Household, User

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL", "postgresql+asyncpg://finance:finance@localhost:5433/finance")
HH_PREFIX = "pytest-m19-"


@pytest_asyncio.fixture
async def engine():
    eng = create_async_engine(TEST_DATABASE_URL)
    try:
        async with eng.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception as exc:  # noqa: BLE001
        await eng.dispose()
        pytest.skip(f"no Postgres at {TEST_DATABASE_URL}: {exc}")
    yield eng
    async with eng.begin() as conn:
        await conn.execute(text("DELETE FROM household WHERE name LIKE :p"), {"p": f"{HH_PREFIX}%"})
    await eng.dispose()


@pytest_asyncio.fixture
async def session(engine):
    sm = async_sessionmaker(engine, expire_on_commit=False)
    async with sm() as s:
        yield s


async def _user(session) -> User:
    hh = Household(name=f"{HH_PREFIX}{_uuid.uuid4().hex[:8]}", base_currency="USD")
    session.add(hh)
    await session.flush()
    user = User(household_id=hh.id, email=f"{_uuid.uuid4().hex}@example.com", password_hash="x", role="owner")
    session.add(user)
    await session.commit()
    return user


@pytest.mark.asyncio
async def test_build_snapshot_returns_currency_and_fields(session):
    user = await _user(session)
    today = date.today()
    snap = await build_snapshot(session, user, today - timedelta(days=30), today)
    assert snap.currency == "USD"
    assert isinstance(snap.budget_overages, list)
    assert isinstance(snap.net_worth, float)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_m19_analyst.py::test_build_snapshot_returns_currency_and_fields -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.analyst.snapshot'`

- [ ] **Step 3: Write minimal implementation**

```python
# backend/app/analyst/snapshot.py
from __future__ import annotations

from datetime import date

from sqlalchemy.ext.asyncio import AsyncSession

from app.analyst.schemas import FinancialSnapshot
from app.analytics import service as analytics
from app.models.core import User
from app.widget_data import service as widgets


def _f(v) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


async def build_snapshot(session: AsyncSession, user: User, from_date: date, to_date: date) -> FinancialSnapshot:
    summary = await analytics.summary(session, user, from_date, to_date, ["category"], compare="prev")
    nw = await analytics.net_worth(session, user, from_date, to_date)
    budgets = await analytics.list_budgets(session, user)
    recs = await analytics.recommendations(session, user)
    recurring = await widgets.list_recurring(session, user, status="active")
    cards = await widgets.list_credit_cards(session, user)

    # Cashflow: analytics totals are spend-positive; income is the negative tail.
    total = _f(summary.get("total"))
    comparison = summary.get("comparison") or {}
    rows = summary.get("rows") or []
    income = sum(_f(r.get("total")) for r in rows if _f(r.get("total")) < 0)
    expenses = sum(_f(r.get("total")) for r in rows if _f(r.get("total")) > 0)

    overages, near = [], []
    for b in budgets:
        pct = _f(b.get("progress_pct"))
        if b.get("overspent"):
            overages.append({"category_id": str(b.get("category_id")) if b.get("category_id") else None,
                             "name": b.get("category_id") and "Category" or "Overall",
                             "over": _f(b.get("spent")) - _f(b.get("amount")), "pct": pct})
        elif pct >= 80:
            near.append({"category_id": str(b.get("category_id")) if b.get("category_id") else None,
                         "name": b.get("category_id") and "Category" or "Overall", "pct": pct})

    top_categories = [{"name": str(next(iter(r.get("dimensions", {}).values()), "Other")), "amount": _f(r.get("total"))}
                      for r in rows[:5]]

    recurring_total = sum(_f(r.get("amount")) for r in recurring)

    return FinancialSnapshot(
        currency=nw.get("currency", "USD"),
        income=abs(income),
        expenses=expenses,
        net=abs(income) - expenses,
        net_delta_pct=_f(comparison.get("delta_pct")) if comparison else None,
        net_worth=_f(nw.get("net_worth")),
        assets=_f(nw.get("assets")),
        liabilities=_f(nw.get("liabilities")),
        budget_overages=overages,
        near_limit_budgets=near,
        top_categories=top_categories,
        upcoming_recurring=[{"name": r.get("merchant_name") or r.get("label") or "Recurring", "amount": _f(r.get("amount"))} for r in recurring[:5]],
        recurring_monthly_total=recurring_total,
        credit_cards=[{"name": c.get("name", "Card"), "utilization": _f(c.get("utilization"))} for c in cards],
        recommendations=[{"id": str(r.id), "type": r.rec_type, "message": (r.payload or {}).get("message", "")} for r in recs[:5]],
    )
```

> NOTE for implementer: confirm `Recommendation` attribute names (`rec_type`, `payload`) against `backend/app/models/*` before running; adjust if the model uses different field names. The `summary` rows' `dimensions` shape is `{dimension: value}` (see `analytics.service._aggregate`).

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_m19_analyst.py::test_build_snapshot_returns_currency_and_fields -v`
Expected: PASS (or SKIP if no Postgres — acceptable)

- [ ] **Step 5: Commit**

```bash
git add backend/app/analyst/snapshot.py backend/tests/test_m19_analyst.py
git commit -m "feat(analyst): financial snapshot builder reusing analytics/widget-data"
```

---

### Task 5: Ask + monitor orchestrators with graceful degradation

**Files:**
- Modify: `backend/app/analyst/service.py`
- Test: `backend/tests/test_m19_analyst.py` (append)

**Interfaces:**
- Consumes: `build_messages`, `derive_alerts`, `build_snapshot`, schemas, `LLMClient`.
- Produces:
  - `async run_ask(session, user, data: AnalystAskIn, llm) -> AnalystAskOut`
  - `async run_monitor(session, user, from_date, to_date) -> MonitorOut`

- [ ] **Step 1: Write the failing test (append)**

```python
# backend/tests/test_m19_analyst.py (append)
from app.analyst import service as analyst_service
from app.analyst.schemas import AnalystAskIn, FinancialSnapshot
from app.llm.errors import LLMError


class _FakeLLM:
    def __init__(self, raise_error=False):
        self.raise_error = raise_error

    async def chat(self, messages, **kw):
        if self.raise_error:
            raise LLMError("no key")
        return {"content": "Because dining rose 38%."}


@pytest.mark.asyncio
async def test_run_ask_returns_answer_when_llm_ok(session, monkeypatch):
    user = await _user(session)

    async def fake_snapshot(*a, **k):
        return FinancialSnapshot(currency="USD", income=5000.0, expenses=4000.0, net=1000.0, net_worth=20000.0, assets=30000.0, liabilities=10000.0)

    monkeypatch.setattr(analyst_service, "build_snapshot", fake_snapshot)
    out = await analyst_service.run_ask(session, user, AnalystAskIn(mode="explain", question="why?"), _FakeLLM())
    assert out.available is True
    assert "dining" in out.answer.lower()


@pytest.mark.asyncio
async def test_run_ask_degrades_when_llm_unavailable(session, monkeypatch):
    user = await _user(session)

    async def fake_snapshot(*a, **k):
        return FinancialSnapshot(currency="USD", income=0.0, expenses=0.0, net=0.0, net_worth=0.0, assets=0.0, liabilities=0.0)

    monkeypatch.setattr(analyst_service, "build_snapshot", fake_snapshot)
    out = await analyst_service.run_ask(session, user, AnalystAskIn(mode="plan", question="plan?"), _FakeLLM(raise_error=True))
    assert out.available is False
    assert out.suggestions == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_m19_analyst.py::test_run_ask_returns_answer_when_llm_ok -v`
Expected: FAIL — `AttributeError: module 'app.analyst.service' has no attribute 'run_ask'`

- [ ] **Step 3: Write minimal implementation (append to service.py)**

```python
# backend/app/analyst/service.py (append)
from datetime import date

from sqlalchemy.ext.asyncio import AsyncSession

from app.analyst.schemas import (
    AnalystActionResponse,
    AnalystAskIn,
    AnalystAskOut,
    MonitorOut,
)
from app.analyst.snapshot import build_snapshot
from app.llm.errors import LLMError
from app.models.core import User

_UNAVAILABLE = "The AI analyst is unavailable right now. Configure an AI provider to enable Explain, Plan, and Action."


async def run_monitor(session: AsyncSession, user: User, from_date: date, to_date: date) -> MonitorOut:
    snapshot = await build_snapshot(session, user, from_date, to_date)
    return MonitorOut(alerts=derive_alerts(snapshot))


async def run_ask(session: AsyncSession, user: User, data: AnalystAskIn, llm) -> AnalystAskOut:
    snapshot = await build_snapshot(session, user, _resolve_from(data), _resolve_to(data))
    messages = build_messages(data.mode, snapshot, data.question)
    try:
        if data.mode == "action":
            result = await llm.chat(messages, json_schema=AnalystActionResponse, purpose="analyst.ask", user_id=user.id, session=session)
            parsed = AnalystActionResponse(**result)
            return AnalystAskOut(answer=parsed.answer, suggestions=parsed.actions, available=True)
        result = await llm.chat(messages, purpose="analyst.ask", user_id=user.id, session=session)
        return AnalystAskOut(answer=result.get("content") or _UNAVAILABLE, suggestions=[], available=True)
    except LLMError:
        return AnalystAskOut(answer=_UNAVAILABLE, suggestions=[], available=False)
    except Exception:  # noqa: BLE001 — never let the analyst 5xx
        return AnalystAskOut(answer=_UNAVAILABLE, suggestions=[], available=False)


def _resolve_from(data: AnalystAskIn) -> date:
    return date.fromisoformat(data.range_from) if data.range_from else _default_from()


def _resolve_to(data: AnalystAskIn) -> date:
    return date.fromisoformat(data.range_to) if data.range_to else date.today()


def _default_from() -> date:
    today = date.today()
    month = today.month - 3
    year = today.year + (month - 1) // 12
    month = (month - 1) % 12 + 1
    return date(year, month, 1)
```

> NOTE: `build_snapshot` is imported into `service` so the monkeypatch in the test (`setattr(analyst_service, "build_snapshot", ...)`) takes effect. Keep the import at module level as shown.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_m19_analyst.py -v`
Expected: PASS (all; DB tests SKIP without Postgres)

- [ ] **Step 5: Commit**

```bash
git add backend/app/analyst/service.py backend/tests/test_m19_analyst.py
git commit -m "feat(analyst): ask + monitor orchestrators with graceful LLM degradation"
```

---

### Task 6: Router + app registration

**Files:**
- Create: `backend/app/analyst/router.py`
- Modify: `backend/app/main.py` (imports near line 71-75; `include_router` near line 95-99)
- Test: `backend/tests/test_m19_analyst.py` (append — assert routes exist on the app)

**Interfaces:**
- Consumes: `run_ask`, `run_monitor`, schemas, `get_current_user`, `get_session`, `get_llm_client`.
- Produces: `GET /analyst/monitor`, `POST /analyst/ask` on the app.

- [ ] **Step 1: Write the failing test (append)**

```python
# backend/tests/test_m19_analyst.py (append)
def test_analyst_routes_registered():
    from app.main import app

    paths = {r.path for r in app.routes}
    assert "/analyst/monitor" in paths
    assert "/analyst/ask" in paths
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_m19_analyst.py::test_analyst_routes_registered -v`
Expected: FAIL — assertion error (paths absent)

- [ ] **Step 3: Write minimal implementation**

```python
# backend/app/analyst/router.py
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.analyst import service
from app.analyst.schemas import AnalystAskIn, AnalystAskOut, MonitorOut
from app.auth.deps import get_current_user
from app.db import get_session
from app.llm.client import LLMClient, get_llm_client
from app.models.core import User

router = APIRouter(prefix="/analyst", tags=["analyst"])


@router.get("/monitor", response_model=MonitorOut)
async def monitor(
    from_date: date = Query(alias="from"),
    to_date: date = Query(alias="to"),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await service.run_monitor(session, user, from_date, to_date)


@router.post("/ask", response_model=AnalystAskOut)
async def ask(
    data: AnalystAskIn,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    llm: LLMClient = Depends(get_llm_client),
):
    return await service.run_ask(session, user, data, llm)
```

In `backend/app/main.py`, add the import alongside the other routers (after the `guidance_router` import line):

```python
from app.analyst.router import router as analyst_router  # noqa: E402
```

and register it alongside the others (after `app.include_router(guidance_router)`):

```python
app.include_router(analyst_router)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_m19_analyst.py -v`
Expected: PASS (all)

- [ ] **Step 5: Commit**

```bash
git add backend/app/analyst/router.py backend/app/main.py backend/tests/test_m19_analyst.py
git commit -m "feat(analyst): /analyst/monitor + /analyst/ask endpoints"
```

---

### Task 7: Regenerate the OpenAPI schema

**Files:**
- Modify: `shared/api-schema.ts`, `shared/openapi.json` (generated)

**Interfaces:**
- Produces: `components["schemas"]["MonitorOut" | "AnalystAlert" | "AnalystAction" | "AnalystAskIn" | "AnalystAskOut"]` and the `/analyst/*` paths in the TS types.

- [ ] **Step 1: Start the API and regenerate**

Run (API must be up on :8000 — start the backend/Docker stack first):
```bash
cd web && npm run gen:api
```

- [ ] **Step 2: Verify the new types landed**

Run: `grep -c "AnalystAskOut\|/analyst/monitor" ../shared/api-schema.ts`
Expected: ≥ 2

- [ ] **Step 3: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add shared/api-schema.ts shared/openapi.json
git commit -m "chore(api): regenerate schema for analyst endpoints"
```

---

## Phase 2 — Frontend shell: provider, blob, floating pane, Monitor

### Task 8: Analyst API hooks

**Files:**
- Create: `web/lib/api/analyst.ts`
- Test: covered indirectly via Vitest in later tasks (no standalone test; this is thin typed glue)

**Interfaces:**
- Consumes: generated types from Task 7, `api`, `presetRange`.
- Produces: `useMonitor(range)`, `useAnalystAsk()`, and re-exported types `Monitor`, `AnalystAlert`, `AnalystAction`, `AskOut`.

- [ ] **Step 1: Write the implementation**

```typescript
// web/lib/api/analyst.ts
import { useMutation, useQuery } from "@tanstack/react-query";
import type { components } from "@shared/api-schema";
import type { DateRange } from "@/lib/dates";
import { api } from "./client";

export type Monitor = components["schemas"]["MonitorOut"];
export type AnalystAlert = components["schemas"]["AnalystAlert"];
export type AnalystAction = components["schemas"]["AnalystAction"];
export type AskIn = components["schemas"]["AnalystAskIn"];
export type AskOut = components["schemas"]["AnalystAskOut"];

async function unwrap<T>(p: Promise<{ data?: T; error?: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error || data === undefined) throw error ?? new Error("Request failed");
  return data;
}

export function useMonitor(range: DateRange) {
  return useQuery<Monitor>({
    queryKey: ["analyst", "monitor", range],
    queryFn: () => unwrap(api.GET("/analyst/monitor", { params: { query: { from: range.from, to: range.to } } })),
  });
}

export function useAnalystAsk() {
  return useMutation({
    mutationFn: (body: AskIn) => unwrap(api.POST("/analyst/ask", { body })),
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add web/lib/api/analyst.ts
git commit -m "feat(analyst): typed monitor + ask hooks"
```

---

### Task 9: Analyst provider (open state, mode, thread, dismissals)

**Files:**
- Create: `web/components/dashboard/analyst/use-analyst.tsx`
- Test: `web/components/dashboard/analyst/use-analyst.test.tsx`

**Interfaces:**
- Produces: `AnalystProvider` (props: `children`, `onAction: (a: AnalystAction) => void`) and `useAnalyst()` returning `{ open, mode, setMode, openPane, closePane, toggle, dismissed, dismiss, undismiss, runAction }`.
- Mode type: `AnalystMode = "monitor" | "explain" | "plan" | "action"`.

- [ ] **Step 1: Write the failing test**

```tsx
// web/components/dashboard/analyst/use-analyst.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { AnalystProvider, useAnalyst } from "./use-analyst";

function Probe() {
  const a = useAnalyst();
  return (
    <div>
      <span data-testid="open">{String(a.open)}</span>
      <span data-testid="mode">{a.mode}</span>
      <button onClick={a.toggle}>toggle</button>
      <button onClick={() => a.setMode("plan")}>plan</button>
      <button onClick={() => a.dismiss("x1")}>dismiss</button>
      <span data-testid="dismissed">{String(a.dismissed.has("x1"))}</span>
    </div>
  );
}

describe("useAnalyst", () => {
  it("toggles open and switches mode and tracks dismissals", () => {
    render(
      <AnalystProvider onAction={vi.fn()}>
        <Probe />
      </AnalystProvider>,
    );
    expect(screen.getByTestId("open").textContent).toBe("false");
    fireEvent.click(screen.getByText("toggle"));
    expect(screen.getByTestId("open").textContent).toBe("true");
    fireEvent.click(screen.getByText("plan"));
    expect(screen.getByTestId("mode").textContent).toBe("plan");
    fireEvent.click(screen.getByText("dismiss"));
    expect(screen.getByTestId("dismissed").textContent).toBe("true");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run components/dashboard/analyst/use-analyst.test.tsx`
Expected: FAIL — cannot resolve `./use-analyst`

- [ ] **Step 3: Write minimal implementation**

```tsx
// web/components/dashboard/analyst/use-analyst.tsx
"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { AnalystAction } from "@/lib/api/analyst";

export type AnalystMode = "monitor" | "explain" | "plan" | "action";

const STORAGE_KEY = "cf-analyst-dismissed";

type Ctx = {
  open: boolean;
  mode: AnalystMode;
  setMode: (m: AnalystMode) => void;
  openPane: (m?: AnalystMode) => void;
  closePane: () => void;
  toggle: () => void;
  dismissed: Set<string>;
  dismiss: (id: string) => void;
  undismiss: (id: string) => void;
  runAction: (a: AnalystAction) => void;
};

const AnalystCtx = createContext<Ctx | null>(null);

export function AnalystProvider({ children, onAction }: { children: ReactNode; onAction: (a: AnalystAction) => void }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<AnalystMode>("monitor");
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setDismissed(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* ignore */
    }
  }, []);

  const persist = useCallback((next: Set<string>) => {
    setDismissed(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      open,
      mode,
      setMode,
      openPane: (m) => {
        if (m) setMode(m);
        setOpen(true);
      },
      closePane: () => setOpen(false),
      toggle: () => setOpen((v) => !v),
      dismissed,
      dismiss: (id) => persist(new Set(dismissed).add(id)),
      undismiss: (id) => {
        const next = new Set(dismissed);
        next.delete(id);
        persist(next);
      },
      runAction: onAction,
    }),
    [open, mode, dismissed, persist, onAction],
  );

  return <AnalystCtx.Provider value={value}>{children}</AnalystCtx.Provider>;
}

export function useAnalyst(): Ctx {
  const ctx = useContext(AnalystCtx);
  if (!ctx) throw new Error("useAnalyst must be used within AnalystProvider");
  return ctx;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run components/dashboard/analyst/use-analyst.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/components/dashboard/analyst/use-analyst.tsx web/components/dashboard/analyst/use-analyst.test.tsx
git commit -m "feat(analyst): provider for open state, mode, dismissals"
```

---

### Task 10: Monitor feed

**Files:**
- Create: `web/components/dashboard/analyst/monitor-feed.tsx`
- Test: `web/components/dashboard/analyst/monitor-feed.test.tsx`

**Interfaces:**
- Consumes: `useMonitor`, `useAnalyst`, `AnalystAlert`, `<Private>`.
- Produces: `MonitorFeed({ range })` — renders alert cards, hides dismissed, fires `runAction` on inline action, `dismiss` on dismiss.

- [ ] **Step 1: Write the failing test**

```tsx
// web/components/dashboard/analyst/monitor-feed.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import type { AnalystAlert } from "@/lib/api/analyst";
import { AlertList } from "./monitor-feed";

const alerts: AnalystAlert[] = [
  { id: "a1", kind: "budget_overspend", severity: 9, tone: "danger", title: "Dining over", detail: "Over by $40", suggested_action: { type: "set_budget", label: "Adjust", params: {} } },
  { id: "a2", kind: "all_clear", severity: 1, tone: "positive", title: "All clear", detail: "Nothing to do", suggested_action: null },
];

describe("AlertList", () => {
  it("renders cards and hides dismissed", () => {
    render(<AlertList alerts={alerts} dismissed={new Set(["a2"])} onAction={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText("Dining over")).toBeInTheDocument();
    expect(screen.queryByText("All clear")).not.toBeInTheDocument();
  });

  it("fires onAction for an alert's suggested action", () => {
    const onAction = vi.fn();
    render(<AlertList alerts={alerts} dismissed={new Set()} onAction={onAction} onDismiss={vi.fn()} />);
    screen.getByRole("button", { name: "Adjust" }).click();
    expect(onAction).toHaveBeenCalledWith(alerts[0].suggested_action);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run components/dashboard/analyst/monitor-feed.test.tsx`
Expected: FAIL — cannot resolve `./monitor-feed`

- [ ] **Step 3: Write minimal implementation**

```tsx
// web/components/dashboard/analyst/monitor-feed.tsx
"use client";
import { X } from "lucide-react";
import type { DateRange } from "@/lib/dates";
import { Private } from "@/components/dashboard/privacy-provider";
import { useMonitor, type AnalystAction, type AnalystAlert } from "@/lib/api/analyst";
import { useAnalyst } from "./use-analyst";

const TONE: Record<AnalystAlert["tone"], string> = {
  danger: "border-red-500/40 bg-red-500/10",
  warning: "border-amber-500/40 bg-amber-500/10",
  info: "border-border bg-card/40",
  positive: "border-emerald-500/40 bg-emerald-500/10",
};

export function AlertList({
  alerts,
  dismissed,
  onAction,
  onDismiss,
}: {
  alerts: AnalystAlert[];
  dismissed: Set<string>;
  onAction: (a: AnalystAction) => void;
  onDismiss: (id: string) => void;
}) {
  const visible = alerts.filter((a) => !dismissed.has(a.id));
  if (visible.length === 0) return <p className="p-4 text-[13px] text-muted">All clear — nothing needs your attention.</p>;
  return (
    <ul className="space-y-2 p-3">
      {visible.map((a) => (
        <li key={a.id} className={`rounded-xl border p-3 ${TONE[a.tone]}`}>
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-fg">{a.title}</p>
              <p className="mt-0.5 text-[12px] text-muted"><Private kind="money">{a.detail}</Private></p>
              {a.suggested_action && (
                <button
                  type="button"
                  onClick={() => onAction(a.suggested_action!)}
                  className="mt-2 rounded-lg bg-accent px-2.5 py-1.5 text-[11px] font-semibold text-on-accent"
                >
                  {a.suggested_action.label}
                </button>
              )}
            </div>
            <button type="button" aria-label="Dismiss" onClick={() => onDismiss(a.id)} className="grid size-6 place-items-center rounded-md text-muted hover:bg-chip hover:text-fg">
              <X className="size-3.5" />
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function MonitorFeed({ range }: { range: DateRange }) {
  const { dismissed, dismiss, runAction } = useAnalyst();
  const q = useMonitor(range);
  if (q.isLoading) return <div className="space-y-2 p-3">{[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-chip" />)}</div>;
  if (q.isError) return <div className="p-4 text-[13px] text-muted">Couldn’t load alerts. <button className="font-semibold text-accent" onClick={() => q.refetch()}>Retry</button></div>;
  return <AlertList alerts={q.data?.alerts ?? []} dismissed={dismissed} onAction={runAction} onDismiss={dismiss} />;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run components/dashboard/analyst/monitor-feed.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/components/dashboard/analyst/monitor-feed.tsx web/components/dashboard/analyst/monitor-feed.test.tsx
git commit -m "feat(analyst): monitor feed with inline actions + dismiss"
```

---

### Task 11: Floating blob (FAB)

**Files:**
- Create: `web/components/dashboard/analyst/analyst-blob.tsx`
- Test: `web/components/dashboard/analyst/analyst-blob.test.tsx`

**Interfaces:**
- Consumes: `useAnalyst`, `useMonitor`.
- Produces: `AnalystBlob({ range })` — fixed bottom-right button, badge = count of non-dismissed alerts, opens pane on click.

- [ ] **Step 1: Write the failing test**

```tsx
// web/components/dashboard/analyst/analyst-blob.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

const toggle = vi.fn();
vi.mock("./use-analyst", () => ({ useAnalyst: () => ({ toggle, open: false, dismissed: new Set() }) }));
vi.mock("@/lib/api/analyst", () => ({ useMonitor: () => ({ data: { alerts: [{ id: "a1", severity: 9 }] } }) }));

import { AnalystBlob } from "./analyst-blob";

describe("AnalystBlob", () => {
  it("renders a labelled FAB with an alert badge and toggles on click", () => {
    render(<AnalystBlob range={{ from: "2026-01-01", to: "2026-03-31" }} />);
    const btn = screen.getByRole("button", { name: /ai analyst/i });
    expect(screen.getByText("1")).toBeInTheDocument();
    fireEvent.click(btn);
    expect(toggle).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run components/dashboard/analyst/analyst-blob.test.tsx`
Expected: FAIL — cannot resolve `./analyst-blob`

- [ ] **Step 3: Write minimal implementation**

```tsx
// web/components/dashboard/analyst/analyst-blob.tsx
"use client";
import { Sparkles } from "lucide-react";
import type { DateRange } from "@/lib/dates";
import { useMonitor } from "@/lib/api/analyst";
import { useAnalyst } from "./use-analyst";

export function AnalystBlob({ range }: { range: DateRange }) {
  const { toggle, open, dismissed } = useAnalyst();
  const q = useMonitor(range);
  const alerts = (q.data?.alerts ?? []).filter((a) => !dismissed.has(a.id));
  const count = alerts.length;
  const urgent = alerts.some((a) => a.severity >= 7);

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="AI Analyst"
      aria-expanded={open}
      className="fixed bottom-6 right-6 z-50 grid size-14 place-items-center rounded-full border border-border bg-[radial-gradient(circle_at_30%_30%,color-mix(in_srgb,var(--accent)_60%,transparent),var(--card))] text-on-accent shadow-card backdrop-blur-xl transition-transform hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
    >
      {urgent && <span className="absolute inset-0 -z-10 animate-ping rounded-full bg-accent/40 motion-reduce:animate-none" />}
      <Sparkles className="size-6 text-accent" />
      {count > 0 && (
        <span className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-red-500 px-1 text-[11px] font-bold text-white">
          {count}
        </span>
      )}
    </button>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run components/dashboard/analyst/analyst-blob.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/components/dashboard/analyst/analyst-blob.tsx web/components/dashboard/analyst/analyst-blob.test.tsx
git commit -m "feat(analyst): floating bottom-right blob (FAB) with alert badge"
```

---

### Task 12: Floating pane shell (Monitor wired; chat tabs placeholder body)

**Files:**
- Create: `web/components/dashboard/analyst/analyst-pane.tsx`
- Test: `web/components/dashboard/analyst/analyst-pane.test.tsx`

**Interfaces:**
- Consumes: `useAnalyst`, `MonitorFeed`, `ChatThread` (Task 13 — import lazily; for this task render a temporary inline note for non-monitor modes, replaced in Task 13).
- Produces: `AnalystPane({ range })` — fixed right-anchored glass overlay, mode tabs Monitor/Explain/Plan/Action, Esc + close button + backdrop click close.

- [ ] **Step 1: Write the failing test**

```tsx
// web/components/dashboard/analyst/analyst-pane.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

let state = { open: true, mode: "monitor" as const };
const setMode = vi.fn((m) => (state = { ...state, mode: m }));
const closePane = vi.fn();
vi.mock("./use-analyst", () => ({ useAnalyst: () => ({ ...state, setMode, closePane, dismissed: new Set(), dismiss: vi.fn(), runAction: vi.fn() }) }));
vi.mock("@/lib/api/analyst", () => ({ useMonitor: () => ({ isLoading: false, isError: false, data: { alerts: [] } }), useAnalystAsk: () => ({ mutateAsync: vi.fn(), isPending: false }) }));

import { AnalystPane } from "./analyst-pane";

describe("AnalystPane", () => {
  it("shows the four mode tabs and closes on Escape", () => {
    render(<AnalystPane range={{ from: "2026-01-01", to: "2026-03-31" }} />);
    for (const t of ["Monitor", "Explain", "Plan", "Action"]) {
      expect(screen.getByRole("tab", { name: t })).toBeInTheDocument();
    }
    fireEvent.keyDown(window, { key: "Escape" });
    expect(closePane).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run components/dashboard/analyst/analyst-pane.test.tsx`
Expected: FAIL — cannot resolve `./analyst-pane`

- [ ] **Step 3: Write minimal implementation**

```tsx
// web/components/dashboard/analyst/analyst-pane.tsx
"use client";
import { useEffect } from "react";
import { Activity, HelpCircle, Sparkles, Target, Wand2, X, type LucideIcon } from "lucide-react";
import type { DateRange } from "@/lib/dates";
import { MonitorFeed } from "./monitor-feed";
import { ChatThread } from "./chat-thread";
import { useAnalyst, type AnalystMode } from "./use-analyst";

const TABS = [
  ["monitor", "Monitor", Activity],
  ["explain", "Explain", HelpCircle],
  ["plan", "Plan", Target],
  ["action", "Action", Wand2],
] as const satisfies readonly [AnalystMode, string, LucideIcon][];

export function AnalystPane({ range }: { range: DateRange }) {
  const { open, mode, setMode, closePane } = useAnalyst();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closePane(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closePane]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/10" onClick={closePane} aria-hidden />
      <aside
        role="dialog"
        aria-label="AI Analyst"
        className="fixed bottom-0 right-0 top-0 z-50 flex w-[min(420px,100vw)] flex-col border-l border-border bg-card/80 shadow-card backdrop-blur-xl"
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="inline-flex items-center gap-2 text-[15px] font-bold text-fg"><Sparkles className="size-4 text-accent" /> AI Analyst</span>
          <button type="button" aria-label="Close" onClick={closePane} className="grid size-7 place-items-center rounded-lg text-muted hover:bg-chip hover:text-fg"><X className="size-3.5" /></button>
        </header>

        <div role="tablist" className="flex items-center gap-1 border-b border-border px-2 py-2">
          {TABS.map(([id, label, Icon]) => (
            <button
              key={id}
              role="tab"
              aria-selected={mode === id}
              onClick={() => setMode(id)}
              className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] font-semibold transition-colors ${mode === id ? "bg-accent-soft/20 text-accent" : "text-muted hover:text-fg"}`}
            >
              <Icon className="size-4" /> {label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {mode === "monitor" ? <MonitorFeed range={range} /> : <ChatThread mode={mode} range={range} />}
        </div>
      </aside>
    </>
  );
}
```

> NOTE: this task imports `ChatThread` from Task 13. Implement Task 13 in the same branch before running the full app; for this task's unit test the import is mocked at the module boundary via the `@/lib/api/analyst` mock and a stub. If running Task 12's test before Task 13 exists, create a minimal `chat-thread.tsx` stub exporting `export function ChatThread() { return null; }` first, then flesh it out in Task 13.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run components/dashboard/analyst/analyst-pane.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/components/dashboard/analyst/analyst-pane.tsx web/components/dashboard/analyst/analyst-pane.test.tsx
git commit -m "feat(analyst): floating glass pane shell with mode tabs + Monitor"
```

---

### Task 13: Chat thread (Explain / Plan / Action) with unavailable state

**Files:**
- Create: `web/components/dashboard/analyst/chat-thread.tsx`
- Create: `web/components/dashboard/analyst/action-card.tsx`
- Test: `web/components/dashboard/analyst/chat-thread.test.tsx`

**Interfaces:**
- Consumes: `useAnalystAsk`, `useAnalyst` (`runAction`), `AnalystAction`, `AskOut`.
- Produces: `ChatThread({ mode, range })`; `ActionCard({ action, onConfirm })`.

- [ ] **Step 1: Write the failing test**

```tsx
// web/components/dashboard/analyst/chat-thread.test.tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

const mutateAsync = vi.fn(async () => ({ answer: "Dining rose 38%.", suggestions: [], available: true }));
vi.mock("@/lib/api/analyst", () => ({ useAnalystAsk: () => ({ mutateAsync, isPending: false }) }));
vi.mock("./use-analyst", () => ({ useAnalyst: () => ({ runAction: vi.fn() }) }));

import { ChatThread } from "./chat-thread";

describe("ChatThread", () => {
  it("submits a question and renders the answer", async () => {
    render(<ChatThread mode="explain" range={{ from: "2026-01-01", to: "2026-03-31" }} />);
    fireEvent.change(screen.getByPlaceholderText(/ask/i), { target: { value: "why did spend rise?" } });
    fireEvent.submit(screen.getByTestId("analyst-composer"));
    await waitFor(() => expect(screen.getByText("Dining rose 38%.")).toBeInTheDocument());
    expect(mutateAsync).toHaveBeenCalledWith({ mode: "explain", question: "why did spend rise?", range_from: "2026-01-01", range_to: "2026-03-31" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run components/dashboard/analyst/chat-thread.test.tsx`
Expected: FAIL — cannot resolve `./chat-thread`

- [ ] **Step 3: Write minimal implementation**

```tsx
// web/components/dashboard/analyst/action-card.tsx
"use client";
import type { AnalystAction } from "@/lib/api/analyst";

const ACTION_TYPES = new Set(["create_widget", "open_personalize", "focus_widget", "set_budget", "snooze_alert", "dismiss_alert"]);

export function isRunnable(a: AnalystAction): boolean {
  return ACTION_TYPES.has(a.type);
}

export function ActionCard({ action, onConfirm }: { action: AnalystAction; onConfirm: (a: AnalystAction) => void }) {
  if (!isRunnable(action)) {
    return <div className="rounded-lg border border-border bg-card/40 p-2 text-[12px] text-muted">{action.label}</div>;
  }
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card/40 p-2">
      <span className="text-[12px] text-fg">{action.label}</span>
      <button type="button" onClick={() => onConfirm(action)} className="rounded-lg bg-accent px-2.5 py-1 text-[11px] font-semibold text-on-accent">Confirm</button>
    </div>
  );
}
```

```tsx
// web/components/dashboard/analyst/chat-thread.tsx
"use client";
import { useState } from "react";
import { Send } from "lucide-react";
import type { DateRange } from "@/lib/dates";
import { useAnalystAsk, type AskOut } from "@/lib/api/analyst";
import { useAnalyst, type AnalystMode } from "./use-analyst";
import { ActionCard } from "./action-card";

const PROMPTS: Record<Exclude<AnalystMode, "monitor">, string[]> = {
  explain: ["Why did my cash flow drop?", "What changed vs last month?"],
  plan: ["Help me cut spending", "Plan to pay off my cards"],
  action: ["Create a coffee-spending widget", "Set a dining budget"],
};

type Msg = { role: "user" | "analyst"; text: string; result?: AskOut };

export function ChatThread({ mode, range }: { mode: Exclude<AnalystMode, "monitor">; range: DateRange }) {
  const { runAction } = useAnalyst();
  const ask = useAnalystAsk();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);

  const submit = async (question: string) => {
    const q = question.trim();
    if (!q) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: q }]);
    try {
      const result = await ask.mutateAsync({ mode, question: q, range_from: range.from, range_to: range.to });
      setMessages((m) => [...m, { role: "analyst", text: result.answer, result }]);
    } catch {
      setMessages((m) => [...m, { role: "analyst", text: "Something went wrong. Try again." }]);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {messages.length === 0 && (
          <div className="flex flex-wrap gap-1.5">
            {PROMPTS[mode].map((p) => (
              <button key={p} type="button" onClick={() => submit(p)} className="rounded-chip bg-chip px-2.5 py-1.5 text-[12px] font-medium text-fg hover:bg-accent-soft/30">{p}</button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "ml-auto w-fit max-w-[85%] rounded-2xl bg-accent px-3 py-2 text-[13px] text-on-accent" : "mr-auto w-full max-w-[92%] space-y-2"}>
            {m.role === "analyst" ? (
              <div className={`rounded-2xl border p-3 text-[13px] ${m.result && m.result.available === false ? "border-amber-500/40 bg-amber-500/10 text-muted" : "border-border bg-card/50 text-fg"}`}>{m.text}</div>
            ) : (
              m.text
            )}
            {m.result?.suggestions?.map((a, j) => <ActionCard key={j} action={a} onConfirm={runAction} />)}
          </div>
        ))}
        {ask.isPending && <div className="mr-auto w-fit rounded-2xl border border-border bg-card/50 px-3 py-2 text-[13px] text-muted">Thinking…</div>}
      </div>

      <form data-testid="analyst-composer" onSubmit={(e) => { e.preventDefault(); void submit(input); }} className="flex items-center gap-2 border-t border-border p-3">
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask the analyst…" className="min-w-0 flex-1 rounded-chip border border-border bg-card px-3 py-2 text-sm outline-none focus:border-accent" />
        <button type="submit" aria-label="Send" className="grid size-9 place-items-center rounded-chip bg-accent text-on-accent"><Send className="size-4" /></button>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run components/dashboard/analyst/chat-thread.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/components/dashboard/analyst/chat-thread.tsx web/components/dashboard/analyst/action-card.tsx web/components/dashboard/analyst/chat-thread.test.tsx
git commit -m "feat(analyst): chat thread for Explain/Plan/Action + action cards"
```

---

## Phase 3 — Wiring, action handlers, remove old toggle, e2e

### Task 14: Action handler mapping (pure)

**Files:**
- Create: `web/components/dashboard/analyst/action-handlers.ts`
- Test: `web/components/dashboard/analyst/action-handlers.test.ts`

**Interfaces:**
- Consumes: `AnalystAction`, the dashboard `controller` (`addWidget`), and callbacks for personalize/focus.
- Produces: `makeActionHandler(deps) -> (a: AnalystAction) => void`, where `deps = { controller, openPersonalize, focusWidget, snooze, dismiss }`.

- [ ] **Step 1: Write the failing test**

```ts
// web/components/dashboard/analyst/action-handlers.test.ts
import { describe, it, expect, vi } from "vitest";
import { makeActionHandler } from "./action-handlers";

function deps() {
  return {
    controller: { addWidget: vi.fn() } as any,
    openPersonalize: vi.fn(),
    focusWidget: vi.fn(),
    snooze: vi.fn(),
    dismiss: vi.fn(),
  };
}

describe("makeActionHandler", () => {
  it("create_widget adds the requested widget type", () => {
    const d = deps();
    makeActionHandler(d)({ type: "create_widget", label: "x", params: { widget: "merchant" } });
    expect(d.controller.addWidget).toHaveBeenCalledWith("merchant");
  });

  it("focus_widget calls focusWidget with the widget id", () => {
    const d = deps();
    makeActionHandler(d)({ type: "focus_widget", label: "x", params: { widget: "cashflow" } });
    expect(d.focusWidget).toHaveBeenCalledWith("cashflow");
  });

  it("unknown type is a no-op (no throw)", () => {
    const d = deps();
    expect(() => makeActionHandler(d)({ type: "nuke", label: "x", params: {} })).not.toThrow();
    expect(d.controller.addWidget).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run components/dashboard/analyst/action-handlers.test.ts`
Expected: FAIL — cannot resolve `./action-handlers`

- [ ] **Step 3: Write minimal implementation**

```ts
// web/components/dashboard/analyst/action-handlers.ts
import type { useDashboard } from "@/lib/dashboard/use-dashboard";
import type { AnalystAction } from "@/lib/api/analyst";

export type ActionDeps = {
  controller: ReturnType<typeof useDashboard>;
  openPersonalize: (tab?: string) => void;
  focusWidget: (widget: string) => void;
  snooze: (id: string) => void;
  dismiss: (id: string) => void;
};

export function makeActionHandler(deps: ActionDeps) {
  return (a: AnalystAction): void => {
    const p = a.params ?? {};
    switch (a.type) {
      case "create_widget":
        if (typeof p.widget === "string") deps.controller.addWidget(p.widget);
        return;
      case "open_personalize":
        deps.openPersonalize(typeof p.tab === "string" ? p.tab : undefined);
        return;
      case "focus_widget":
        if (typeof p.widget === "string") deps.focusWidget(p.widget);
        return;
      case "set_budget":
        // routes the user to the budgets controls; real mutation is confirmed there
        deps.openPersonalize("widgets");
        return;
      case "snooze_alert":
      case "dismiss_alert":
        if (typeof p.id === "string") deps.dismiss(p.id);
        return;
      default:
        return; // unknown → no-op (rendered as advice text upstream)
    }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run components/dashboard/analyst/action-handlers.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/components/dashboard/analyst/action-handlers.ts web/components/dashboard/analyst/action-handlers.test.ts
git commit -m "feat(analyst): action-type to capability handler mapping"
```

---

### Task 15: Mount on the dashboard page + remove the toolbar Analyst toggle

**Files:**
- Modify: `web/app/(app)/dashboard/page.tsx`
- Modify: `web/components/dashboard/controls/dashboard-controls.tsx` (remove `analyst-toggle` button at lines ~64-74; drop `PanelRight` import if now unused; fix the header comment line ~14)
- Test: `web/components/dashboard/controls/dashboard-controls.test.tsx` (create if absent — assert the toggle is gone)

**Interfaces:**
- Consumes: `AnalystProvider`, `AnalystBlob`, `AnalystPane`, `makeActionHandler`, `presetRange`.

- [ ] **Step 1: Write the failing test**

```tsx
// web/components/dashboard/controls/dashboard-controls.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { DashboardControls } from "./dashboard-controls";

describe("DashboardControls", () => {
  it("no longer renders the old analyst toggle (blob replaces it)", () => {
    render(<DashboardControls range="3m" onRangeChange={vi.fn()} editing={false} onToggleEditing={vi.fn()} />);
    expect(screen.queryByTestId("analyst-toggle")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run components/dashboard/controls/dashboard-controls.test.tsx`
Expected: FAIL — `analyst-toggle` still present

- [ ] **Step 3: Edit `dashboard-controls.tsx`**

Remove the entire `{/* STUB — AI Analyst Pane toggle (slice G) */}` button block (the `<button ... data-testid="analyst-toggle" ...>` element). Update the import line to drop `PanelRight` (keep `CheckCircle2, Settings2`):

```tsx
import { CheckCircle2, Settings2 } from "lucide-react";
```

Update the header comment (line ~14) to remove the "Analyst toggle (G)" stub note:

```tsx
 * until their slices): Ask-AI bar (G), Review chip (H). The AI Analyst is opened
 * from the floating blob on the dashboard, not from this bar.
```

- [ ] **Step 4: Edit `page.tsx` to mount the analyst**

Add imports:

```tsx
import { AnalystProvider } from "@/components/dashboard/analyst/use-analyst";
import { AnalystBlob } from "@/components/dashboard/analyst/analyst-blob";
import { AnalystPane } from "@/components/dashboard/analyst/analyst-pane";
import { makeActionHandler } from "@/components/dashboard/analyst/action-handlers";
import { presetRange } from "@/lib/dates";
```

Inside `DashboardPage`, after `const editing = ...`, build the range and action handler:

```tsx
  const range = presetRange(controller.state.prefs.range);
  const onAction = makeActionHandler({
    controller,
    openPersonalize: (t) => { setTab((t as PaneTab) ?? "layout"); setOpen(true); },
    focusWidget: (widget) => {
      document.querySelector(`[data-widget="${widget}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    },
    snooze: () => {},
    dismiss: () => {},
  });
```

Wrap the returned tree in `<AnalystProvider onAction={onAction}>` and render the blob + pane just before `</AnalystProvider>` (inside, after `OnboardingModal`):

```tsx
  return (
    <AnalystProvider onAction={onAction}>
      <div className="space-y-3">
        {/* ...existing blurb, DashboardControls, PrivacyProvider/DashboardGrid, OnboardingModal... */}
      </div>
      <AnalystBlob range={range} />
      <AnalystPane range={range} />
    </AnalystProvider>
  );
```

> NOTE: `dismiss`/`snooze` from monitor are handled inside the provider/feed already; the handler's `dismiss` here is only for LLM-suggested `dismiss_alert` actions and can be a no-op for this slice (alerts dismissed from the feed cover the real case). Keep the signature for forward-compat.

- [ ] **Step 5: Run tests + typecheck**

Run: `cd web && npx vitest run components/dashboard/controls/dashboard-controls.test.tsx && npx tsc --noEmit`
Expected: PASS, no type errors

- [ ] **Step 6: Commit**

```bash
git add web/app/"(app)"/dashboard/page.tsx web/components/dashboard/controls/dashboard-controls.tsx web/components/dashboard/controls/dashboard-controls.test.tsx
git commit -m "feat(analyst): mount blob+pane on dashboard, remove old toolbar toggle"
```

---

### Task 16: E2E — blob opens floating pane, mode switch, Monitor renders

**Files:**
- Create: `web/e2e/analyst-pane.spec.ts`

**Interfaces:**
- Consumes: the running app + API; reuses the auth/seed helper pattern from `dashboard-grid.spec.ts`.

- [ ] **Step 1: Write the test**

```ts
// web/e2e/analyst-pane.spec.ts
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

const API = process.env.E2E_API_URL ?? "http://localhost:8000";
const EMAIL = process.env.E2E_EMAIL ?? "dev@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "hunter2pass";

async function signup(request: APIRequestContext) {
  const res = await request.post(`${API}/auth/signup`, { data: { email: EMAIL, password: PASSWORD, display_name: "E2E", household_name: "E2E House" } });
  if (res.ok()) return (await res.json()) as { access_token: string; refresh_token: string };
  const login = await request.post(`${API}/auth/login`, { data: { email: EMAIL, password: PASSWORD, totp_code: null } });
  expect(login.ok()).toBeTruthy();
  return (await login.json()) as { access_token: string; refresh_token: string };
}

async function authenticate(page: Page, tokens: { access_token: string; refresh_token: string }) {
  await page.addInitScript((t) => {
    window.localStorage.setItem("cbf.accessToken", t.access);
    window.localStorage.setItem("cbf.refreshToken", t.refresh);
    window.localStorage.setItem("cf-onboarded:dashboard", "1");
  }, { access: tokens.access_token, refresh: tokens.refresh_token });
}

test("blob opens the floating analyst pane and switches modes", async ({ page, request }) => {
  await authenticate(page, await signup(request));
  await page.goto("/dashboard");

  const blob = page.getByRole("button", { name: /ai analyst/i });
  await expect(blob).toBeVisible();
  await blob.click();

  const pane = page.getByRole("dialog", { name: /ai analyst/i });
  await expect(pane).toBeVisible();
  await expect(pane.getByRole("tab", { name: "Monitor" })).toBeVisible();

  await pane.getByRole("tab", { name: "Explain" }).click();
  await expect(pane.getByPlaceholder(/ask the analyst/i)).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(pane).toBeHidden();
});
```

- [ ] **Step 2: Run the test**

Run: `cd web && npx playwright test e2e/analyst-pane.spec.ts`
Expected: PASS (requires app + API running)

- [ ] **Step 3: Commit**

```bash
git add web/e2e/analyst-pane.spec.ts
git commit -m "test(analyst): e2e blob opens floating pane + mode switch"
```

---

### Task 17: Full verification sweep

**Files:** none (verification only)

- [ ] **Step 1: Backend tests**

Run (in the api container): `pytest tests/test_m19_analyst.py tests/test_m7_analytics.py tests/test_m18_widget_data.py -v`
Expected: PASS (analyst DB tests may SKIP without Postgres)

- [ ] **Step 2: Frontend unit tests + typecheck**

Run: `cd web && npx vitest run && npx tsc --noEmit`
Expected: all PASS, no type errors

- [ ] **Step 3: E2E**

Run: `cd web && npx playwright test e2e/dashboard-grid.spec.ts e2e/analyst-pane.spec.ts`
Expected: PASS (pre-existing `:72`/`:169` failures in `dashboard-grid.spec.ts` are known and unrelated — see memory)

- [ ] **Step 4: Final commit (if any cleanup)**

```bash
git add -A && git commit -m "chore(analyst): slice G verification sweep" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage:**
- Floating pane + bottom-right blob → Tasks 11, 12. ✓
- Always-present blob → Task 11 (`fixed`, always rendered). ✓
- Remove other analyst-pane openers (toolbar toggle) → Task 15. ✓
- Ask-AI bar left as-is → not touched (only the toggle removed). ✓
- New backend `app/analyst`, snapshot reusing analytics/widget_data → Tasks 1-6. ✓
- `GET /analyst/monitor` deterministic, no LLM → Tasks 2, 5, 6. ✓
- `POST /analyst/ask` mode-aware via LLM gateway → Tasks 3, 5, 6. ✓
- Graceful degradation when no provider key → Task 5 (`available=False`, HTTP 200) + Task 13 (unavailable UI). ✓
- Four real modes: Monitor (Task 10), Explain/Plan (Task 13), Action (Tasks 13-14). ✓
- Privacy masking in Monitor → Task 10 (`<Private>`). ✓
- Tests backend/Vitest/e2e → throughout + Task 17. ✓
- Deferred (tone presets) → correctly absent. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. The two NOTEs (Recommendation field names in Task 4; ChatThread stub ordering in Task 12) are explicit implementer guidance, not deferrals.

**Type consistency:** `AnalystMode` (FE) vs `Mode` (BE explain/plan/action) — FE adds `"monitor"`; `ChatThread` takes `Exclude<AnalystMode,"monitor">` matching BE `Mode`. `useMonitor/useAnalystAsk` names consistent across Tasks 8-13. `runAction`/`makeActionHandler` signatures consistent (Tasks 9, 13, 14). `addWidget` matches `use-dashboard.ts` export. Action allow-list identical in BE schema (Task 1) and FE `action-card.ts`/`action-handlers.ts` (Tasks 13-14).
