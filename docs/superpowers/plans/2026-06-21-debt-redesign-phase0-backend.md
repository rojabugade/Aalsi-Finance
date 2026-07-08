# Debt Redesign — Phase 0: Debt-Aware AI (Backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the analyst debt-aware and add a structured `POST /analyst/debt-plan` endpoint where the LLM chooses the payoff strategy, extra payment, and narrative while deterministic math computes every dollar figure.

**Architecture:** Extend `FinancialSnapshot` with a trimmed `loans` list so existing `/analyst/ask` (and thus the AI Coach chat) sees debts. Add a new `analyst/debt_plan.py` module that computes deterministic payoff scenarios by reusing `loans.service._project` and the snowball/avalanche ordering, then asks the LLM only for `{strategy, extra_monthly, headline, narrative}`. The service recomputes all numbers from the LLM's chosen plan; on any LLM error it returns the deterministic plan with `source:"deterministic"`.

**Tech Stack:** FastAPI, SQLAlchemy async, Pydantic v2, pytest-asyncio, existing LLM gateway (`app.llm.client.LLMClient.chat(messages, json_schema=..., purpose=..., user_id=..., session=...)`).

## Global Constraints

- The LLM is NEVER the source of a money figure. It returns only `strategy`, `extra_monthly`, `headline`, `narrative`. All amounts, dates, ordering, and per-loan allocations are computed deterministically. (Spec: "AI decides, math computes".)
- Don't invoke the LLM for anything math can do. Ordering = snowball (smallest balance first) / avalanche (highest rate first), pure math.
- Reuse existing helpers; do NOT reimplement amortization: `loans.service._project`, `_money`, `_rate`, `_monthly_rate`, `list_loans`, `scoped_query`.
- The optional analyst must never turn a provider failure into a 5xx — catch `LLMError`/`Exception` and degrade to `available:false` / `source:"deterministic"`.
- Backend tests run in the api Docker container; the loans-touching suite needs the `finance_test` DB. Analyst service tests use monkeypatched snapshot + a `FakeLLM` (no DB), mirroring `tests/test_m19_analyst.py`.
- Decimal money quantized via `_money` (2dp). `extra_monthly` clamped to `[0, 10000]`.

---

### Task 1: Add `loans` to the financial snapshot

**Files:**
- Modify: `backend/app/analyst/schemas.py` (FinancialSnapshot)
- Modify: `backend/app/analyst/snapshot.py` (build_snapshot)
- Test: `backend/tests/test_m19_analyst.py`

**Interfaces:**
- Produces: `FinancialSnapshot.loans: list[dict[str, Any]]` — each `{ "name", "type", "schedule_kind", "outstanding": float, "principal": float, "interest_rate": float|None, "monthly": float|None, "next_due": str|None }`.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_m19_analyst.py`:

```python
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
    async def empty(*a, **k): return {}
    async def empty_list(*a, **k): return []
    monkeypatch.setattr(snapshot_mod.analytics, "summary", lambda *a, **k: _async({"rows": []}))
    monkeypatch.setattr(snapshot_mod.analytics, "net_worth", lambda *a, **k: _async({"currency": "USD"}))
    monkeypatch.setattr(snapshot_mod.analytics, "list_budgets", lambda *a, **k: _async([]))
    monkeypatch.setattr(snapshot_mod.analytics, "recommendations", lambda *a, **k: _async([]))
    monkeypatch.setattr(snapshot_mod.widgets, "list_recurring", lambda *a, **k: _async([]))
    monkeypatch.setattr(snapshot_mod.widgets, "list_credit_cards", lambda *a, **k: _async([]))
    monkeypatch.setattr(snapshot_mod.loans_service, "list_loans", fake_list_loans)

    snap = await snapshot_mod.build_snapshot(None, SimpleNamespace(id="u"), date(2024, 1, 1), date(2024, 1, 31))
    assert snap.loans and snap.loans[0]["name"] == "Home Loan"
    assert snap.loans[0]["outstanding"] == 450000.0
    assert snap.loans[0]["monthly"] == 2840.0


def _async(value):
    async def _coro(*a, **k):
        return value
    return _coro()
```

Note: if `_async`/`SimpleNamespace`/`date` aren't already imported in the test file, add `from datetime import date`, `from types import SimpleNamespace` at the top (check first — `SimpleNamespace` is already used).

- [ ] **Step 2: Run test to verify it fails**

Run: `docker exec codename-missing-api-1 sh -c "cd /app && python -m pytest tests/test_m19_analyst.py::test_build_snapshot_includes_loans -v"`
Expected: FAIL — `AttributeError` (no `loans_service` on snapshot module) / `FinancialSnapshot` has no `loans`.

- [ ] **Step 3: Add the schema field**

In `backend/app/analyst/schemas.py`, inside `FinancialSnapshot` (after `credit_cards`):

```python
    loans: list[dict[str, Any]] = Field(default_factory=list)
```

- [ ] **Step 4: Populate it in build_snapshot**

In `backend/app/analyst/snapshot.py`, add the import near the top:

```python
from app.loans import service as loans_service
```

Inside `build_snapshot`, after `cards = await widgets.list_credit_cards(...)`:

```python
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
```

Then add `loans=loans,` to the `FinancialSnapshot(...)` return.

- [ ] **Step 5: Run test to verify it passes**

Run: `docker exec codename-missing-api-1 sh -c "cd /app && python -m pytest tests/test_m19_analyst.py::test_build_snapshot_includes_loans -v"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/analyst/schemas.py backend/app/analyst/snapshot.py backend/tests/test_m19_analyst.py
git commit -m "feat(analyst): include loans in financial snapshot"
```

---

### Task 2: Debt-plan schemas

**Files:**
- Modify: `backend/app/analyst/schemas.py`
- Test: `backend/tests/test_m19_analyst.py`

**Interfaces:**
- Produces:
  - `DebtPlanLLM(BaseModel)` — the json_schema the LLM fills: `strategy: Literal["snowball","avalanche"]`, `extra_monthly: float`, `headline: str`, `narrative: str`.
  - `DebtPlanOrderItem(BaseModel)` — `loan_id: uuid.UUID`, `name: str`, `order: int`, `extra_allocation: Decimal`, `rationale: str`, `impact: str`.
  - `DebtPlanOut(BaseModel)` — `available: bool = True`, `source: Literal["ai","deterministic"]`, `strategy: str`, `extra_monthly: Decimal`, `headline: str`, `narrative: str = ""`, `ordered: list[DebtPlanOrderItem]`, `currency: str`, `interest_saved: Decimal`, `months_sooner: int`, `baseline_payoff_date: date | None`, `optimized_payoff_date: date | None`, `updated_at: datetime`.

- [ ] **Step 1: Write the failing test**

```python
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
```

Add imports to the test file if missing: `from decimal import Decimal`, `from datetime import datetime, timezone`.

- [ ] **Step 2: Run test to verify it fails**

Run: `docker exec codename-missing-api-1 sh -c "cd /app && python -m pytest tests/test_m19_analyst.py::test_debt_plan_schemas_exist -v"`
Expected: FAIL — `ImportError: cannot import name 'DebtPlanLLM'`.

- [ ] **Step 3: Add the schemas**

In `backend/app/analyst/schemas.py` add imports at top:

```python
import uuid
from datetime import date, datetime
from decimal import Decimal
```

Append at the end of the file:

```python
class DebtPlanLLM(BaseModel):
    """The narrow set of judgment calls the LLM is allowed to make."""
    strategy: Literal["snowball", "avalanche"]
    extra_monthly: float = Field(ge=0)
    headline: str
    narrative: str = ""


class DebtPlanOrderItem(BaseModel):
    loan_id: uuid.UUID
    name: str
    order: int
    extra_allocation: Decimal
    rationale: str
    impact: str


class DebtPlanOut(BaseModel):
    available: bool = True
    source: Literal["ai", "deterministic"]
    strategy: str
    extra_monthly: Decimal
    headline: str
    narrative: str = ""
    ordered: list[DebtPlanOrderItem] = Field(default_factory=list)
    currency: str
    interest_saved: Decimal
    months_sooner: int
    baseline_payoff_date: date | None = None
    optimized_payoff_date: date | None = None
    updated_at: datetime
```

- [ ] **Step 4: Run test to verify it passes**

Run: `docker exec codename-missing-api-1 sh -c "cd /app && python -m pytest tests/test_m19_analyst.py::test_debt_plan_schemas_exist -v"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/analyst/schemas.py backend/tests/test_m19_analyst.py
git commit -m "feat(analyst): add debt-plan schemas"
```

---

### Task 3: Deterministic debt-plan math (`analyst/debt_plan.py`)

**Files:**
- Create: `backend/app/analyst/debt_plan.py`
- Test: `backend/tests/test_m19_analyst.py`

**Interfaces:**
- Consumes: `loans.service._project`, `_money`, `_rate`; `models.debt.Loan`; `auth/household.scoped_query`.
- Produces:
  - `def order_loans(loans: list[Loan], strategy: str) -> list[Loan]` — snowball/avalanche ordering (same keys as `payoff_strategy`).
  - `def project_total(loans: list[Loan], extra_monthly: Decimal, strategy: str) -> dict` — returns `{ "months": int, "interest": Decimal, "payoff_date": date | None }`. Baseline = each loan at its `min_or_emi_amount`; optimized = the rank-1 loan gets `min + extra`, others at min. Uses `_project` per loan; aggregate months = max per-loan months, payoff_date = latest per-loan final `due_date`, interest = sum of per-loan interest.
  - `def build_ordered(loans: list[Loan], extra_monthly: Decimal, strategy: str) -> list[DebtPlanOrderItem]` — rank-1 gets `extra_allocation = extra_monthly` and `impact = "Highest impact"`; the rest `extra_allocation = 0` / `impact = "Maintain minimum"`; rationale = strategy reason string.

- [ ] **Step 1: Write the failing test**

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker exec codename-missing-api-1 sh -c "cd /app && python -m pytest tests/test_m19_analyst.py::test_project_total_extra_reduces_interest_and_months -v"`
Expected: FAIL — `ModuleNotFoundError: app.analyst.debt_plan`.

- [ ] **Step 3: Implement the module**

Create `backend/app/analyst/debt_plan.py`:

```python
from __future__ import annotations

from datetime import date
from decimal import Decimal

from app.analyst.schemas import DebtPlanOrderItem
from app.loans.service import _money, _project, _rate
from app.models.debt import Loan

_REASON = {
    "avalanche": "highest interest rate first minimizes total interest",
    "snowball": "smallest balance first builds momentum with quick wins",
}


def order_loans(loans: list[Loan], strategy: str) -> list[Loan]:
    if strategy == "avalanche":
        return sorted(loans, key=lambda loan: (_rate(loan.interest_rate), _money(loan.principal)), reverse=True)
    return sorted(loans, key=lambda loan: (_money(loan.principal), -_rate(loan.interest_rate)))


def _payment_for(loan: Loan) -> Decimal:
    # Fall back to a 2%-of-principal nominal payment when a loan has no EMI set,
    # so projection terminates instead of running to the 600-month cap.
    if loan.min_or_emi_amount is not None:
        return _money(loan.min_or_emi_amount)
    return _money(_money(loan.principal) * Decimal("0.02"))


def project_total(loans: list[Loan], extra_monthly: Decimal, strategy: str) -> dict:
    ordered = order_loans(loans, strategy)
    target_id = ordered[0].id if ordered else None
    months = 0
    interest = Decimal("0.00")
    payoff_date: date | None = None
    for loan in loans:
        payment = _payment_for(loan)
        if loan.id == target_id:
            payment = _money(payment + extra_monthly)
        rows = _project(loan, payment, [])
        if not rows:
            continue
        months = max(months, len(rows))
        interest = _money(interest + _money(sum((r["interest_component"] for r in rows), Decimal("0.00"))))
        last_due = rows[-1]["due_date"]
        payoff_date = last_due if payoff_date is None else max(payoff_date, last_due)
    return {"months": months, "interest": interest, "payoff_date": payoff_date}


def build_ordered(loans: list[Loan], extra_monthly: Decimal, strategy: str) -> list[DebtPlanOrderItem]:
    ordered = order_loans(loans, strategy)
    reason = _REASON.get(strategy, _REASON["snowball"])
    items: list[DebtPlanOrderItem] = []
    for idx, loan in enumerate(ordered, start=1):
        first = idx == 1
        items.append(
            DebtPlanOrderItem(
                loan_id=loan.id,
                name=loan.name,
                order=idx,
                extra_allocation=_money(extra_monthly) if first else Decimal("0.00"),
                rationale=reason,
                impact="Highest impact" if first else "Maintain minimum",
            )
        )
    return items
```

- [ ] **Step 4: Run test to verify it passes**

Run: `docker exec codename-missing-api-1 sh -c "cd /app && python -m pytest tests/test_m19_analyst.py::test_project_total_extra_reduces_interest_and_months -v"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/analyst/debt_plan.py backend/tests/test_m19_analyst.py
git commit -m "feat(analyst): deterministic debt-plan projection math"
```

---

### Task 4: `run_debt_plan` service (LLM judgment + deterministic numbers + fallback)

**Files:**
- Modify: `backend/app/analyst/service.py`
- Test: `backend/tests/test_m19_analyst.py`

**Interfaces:**
- Consumes: `debt_plan.order_loans/project_total/build_ordered`, `DebtPlanLLM`, `DebtPlanOut`, `scoped_query`, `Loan`, `LLMClient.chat`.
- Produces: `async def run_debt_plan(session, user, llm) -> DebtPlanOut`.

- [ ] **Step 1: Write the failing test**

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `docker exec codename-missing-api-1 sh -c "cd /app && python -m pytest tests/test_m19_analyst.py -k run_debt_plan -v"`
Expected: FAIL — `AttributeError: module 'app.analyst.service' has no attribute 'run_debt_plan'`.

- [ ] **Step 3: Implement the service**

In `backend/app/analyst/service.py` add imports:

```python
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import select

from app.analyst import debt_plan as dp
from app.analyst.schemas import DebtPlanLLM, DebtPlanOut
from app.auth.household import scoped_query
from app.models.debt import Loan
```

(If `scoped_query` lives elsewhere, match `loans/service.py`'s import — grep `from app...import scoped_query`.)

Add module constants and helpers:

```python
_DEBT_SYSTEM = (
    "You are a personal-finance debt coach. You are given the user's loans and two "
    "precomputed payoff scenarios (snowball and avalanche). Decide which strategy best fits "
    "this user and a sensible extra monthly payment to recommend. Return ONLY the JSON fields "
    "requested. Do NOT compute or state any totals, savings, dates, or month counts — those are "
    "calculated for you. headline is one short sentence; narrative is 2-3 sentences of plain-text "
    "coaching. Never use Markdown."
)
_EXTRA_CAP = Decimal("10000")


async def _debt_loans(session, user) -> list[Loan]:
    return list((await session.execute(scoped_query(Loan, user))).scalars().all())


def _clamp_extra(value) -> Decimal:
    try:
        amount = Decimal(str(value))
    except Exception:
        amount = Decimal("0")
    if amount < 0:
        amount = Decimal("0")
    if amount > _EXTRA_CAP:
        amount = _EXTRA_CAP
    return amount.quantize(Decimal("0.01"))


def _default_extra(loans: list[Loan]) -> Decimal:
    total_min = sum((Decimal(str(loan.min_or_emi_amount or 0)) for loan in loans), Decimal("0"))
    return _clamp_extra(total_min * Decimal("0.1"))


def _default_strategy(loans: list[Loan]) -> str:
    return "avalanche" if any(loan.interest_rate is not None for loan in loans) else "snowball"


def _assemble_plan(loans, *, strategy, extra, source, headline, narrative, currency) -> DebtPlanOut:
    extra = _clamp_extra(extra)
    base = dp.project_total(loans, Decimal("0"), strategy)
    opt = dp.project_total(loans, extra, strategy)
    interest_saved = max(Decimal("0.00"), base["interest"] - opt["interest"])
    months_sooner = max(0, base["months"] - opt["months"])
    return DebtPlanOut(
        available=source == "ai",
        source=source,
        strategy=strategy,
        extra_monthly=extra,
        headline=headline,
        narrative=narrative,
        ordered=dp.build_ordered(loans, extra, strategy),
        currency=currency,
        interest_saved=interest_saved,
        months_sooner=months_sooner,
        baseline_payoff_date=base["payoff_date"],
        optimized_payoff_date=opt["payoff_date"],
        updated_at=datetime.now(timezone.utc),
    )


async def run_debt_plan(session, user, llm) -> DebtPlanOut:
    loans = await _debt_loans(session, user)
    if not loans:
        return DebtPlanOut(
            available=True, source="deterministic", strategy="avalanche",
            extra_monthly=Decimal("0.00"), headline="No debts to plan yet.", narrative="",
            ordered=[], currency=getattr(loans[0], "currency", "USD") if loans else "USD",
            interest_saved=Decimal("0.00"), months_sooner=0,
            baseline_payoff_date=None, optimized_payoff_date=None,
            updated_at=datetime.now(timezone.utc),
        )
    currency = loans[0].currency or "USD"
    snapshot = {
        "loans": [
            {"name": loan.name, "type": loan.type, "schedule_kind": loan.schedule_kind,
             "principal": float(loan.principal), "interest_rate": (None if loan.interest_rate is None else float(loan.interest_rate)),
             "monthly": (None if loan.min_or_emi_amount is None else float(loan.min_or_emi_amount))}
            for loan in loans
        ],
        "scenarios": {
            s: {
                "order": [loan.name for loan in dp.order_loans(loans, s)],
                "baseline": dp.project_total(loans, Decimal("0"), s),
                "with_extra_100": dp.project_total(loans, Decimal("100"), s),
            }
            for s in ("snowball", "avalanche")
        },
    }
    messages = [
        {"role": "system", "content": _DEBT_SYSTEM},
        {"role": "user", "content": f"Loans and precomputed scenarios (JSON):\n{snapshot}"},
    ]
    try:
        result = await llm.chat(messages, json_schema=DebtPlanLLM, purpose="analyst.debt_plan",
                                user_id=user.id, session=session)
        parsed = DebtPlanLLM(**result)
        return _assemble_plan(
            loans, strategy=parsed.strategy, extra=parsed.extra_monthly, source="ai",
            headline=parsed.headline, narrative=parsed.narrative, currency=currency,
        )
    except LLMError:
        pass
    except Exception:  # never 5xx from the optional analyst
        pass
    strategy = _default_strategy(loans)
    extra = _default_extra(loans)
    return _assemble_plan(
        loans, strategy=strategy, extra=extra, source="deterministic",
        headline=f"Pay {dp.order_loans(loans, strategy)[0].name} first — {dp._REASON[strategy]}.",
        narrative="", currency=currency,
    )
```

Note: the `snapshot` dict embeds `project_total` results whose `Decimal`/`date` values stringify fine for the prompt. If `json_schema` JSON-serializes the prompt strictly elsewhere, this is still a plain f-string — no serialization constraint.

- [ ] **Step 4: Run tests to verify they pass**

Run: `docker exec codename-missing-api-1 sh -c "cd /app && python -m pytest tests/test_m19_analyst.py -k run_debt_plan -v"`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/app/analyst/service.py backend/tests/test_m19_analyst.py
git commit -m "feat(analyst): run_debt_plan with LLM strategy choice and deterministic numbers"
```

---

### Task 5: `POST /analyst/debt-plan` endpoint

**Files:**
- Modify: `backend/app/analyst/router.py`
- Test: `backend/tests/test_m19_analyst.py`

**Interfaces:**
- Consumes: `service.run_debt_plan`, `DebtPlanOut`, `get_current_user`, `get_session`, `get_llm_client`.
- Produces: route `POST /analyst/debt-plan` → `DebtPlanOut`.

- [ ] **Step 1: Write the failing test**

Extend the existing route-registration test (around `tests/test_m19_analyst.py:82`) or add:

```python
def test_debt_plan_route_registered():
    from app.main import app
    paths = {route.path for route in app.routes}
    assert "/analyst/debt-plan" in paths
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker exec codename-missing-api-1 sh -c "cd /app && python -m pytest tests/test_m19_analyst.py::test_debt_plan_route_registered -v"`
Expected: FAIL — assertion error (path absent).

- [ ] **Step 3: Add the endpoint**

In `backend/app/analyst/router.py`, extend the schemas import to include `DebtPlanOut`, then append:

```python
@router.post("/debt-plan", response_model=DebtPlanOut)
async def debt_plan(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    llm: LLMClient = Depends(get_llm_client),
):
    return await service.run_debt_plan(session, user, llm)
```

Update the import line to:

```python
from app.analyst.schemas import AnalystAskIn, AnalystAskOut, DebtPlanOut, MonitorOut
```

- [ ] **Step 4: Run test to verify it passes**

Run: `docker exec codename-missing-api-1 sh -c "cd /app && python -m pytest tests/test_m19_analyst.py::test_debt_plan_route_registered -v"`
Expected: PASS

- [ ] **Step 5: Run the full analyst suite (no regressions)**

Run: `docker exec codename-missing-api-1 sh -c "cd /app && python -m pytest tests/test_m19_analyst.py -v"`
Expected: PASS (all)

- [ ] **Step 6: Commit**

```bash
git add backend/app/analyst/router.py backend/tests/test_m19_analyst.py
git commit -m "feat(analyst): add POST /analyst/debt-plan endpoint"
```

---

### Task 6: Regenerate shared API types + frontend `useDebtPlan` hook

**Files:**
- Modify: `web/shared/api-schema.d.ts` (regenerated)
- Modify: `web/lib/api/analyst.ts`
- Test: `web/lib/api/analyst.test.ts` (create if absent — otherwise typecheck is the gate)

**Interfaces:**
- Produces: `useDebtPlan()` → React Query result of `components["schemas"]["DebtPlanOut"]`, calling `POST /analyst/debt-plan`.

- [ ] **Step 1: Regenerate the OpenAPI types**

The repo generates `web/shared/api-schema.d.ts` from the backend OpenAPI. Find the script:

Run: `cd /Users/kshtj/CourseWork/Study/Projects/CodeName-Missing/web && grep -n "openapi\|api-schema\|schema:gen\|generate" package.json`
Then run the matching script (commonly `npm run gen:api` / `npm run openapi`) with the api container up. Confirm `DebtPlanOut` now exists:

Run: `grep -c "DebtPlanOut" web/shared/api-schema.d.ts`
Expected: ≥ 1

- [ ] **Step 2: Add the hook**

In `web/lib/api/analyst.ts`, add the type alias near the others:

```typescript
export type DebtPlan = components["schemas"]["DebtPlanOut"];
```

And the hook (uses a query so the card can show "updated Xs ago" and refetch):

```typescript
import { useQuery } from "@tanstack/react-query";

export function useDebtPlan() {
  return useQuery<DebtPlan>({
    queryKey: ["analyst", "debt-plan"],
    queryFn: () => unwrap(api.POST("/analyst/debt-plan", {})),
    staleTime: 60_000,
  });
}
```

(`useQuery` may already be imported — keep one import.)

- [ ] **Step 3: Typecheck**

Run: `cd /Users/kshtj/CourseWork/Study/Projects/CodeName-Missing/web && npm run typecheck`
Expected: PASS (no errors referencing `DebtPlan` / `debt-plan`)

- [ ] **Step 4: Commit**

```bash
git add web/shared/api-schema.d.ts web/lib/api/analyst.ts
git commit -m "feat(web): useDebtPlan hook + regenerated api types"
```

---

## Self-Review

**Spec coverage (Phase 0 scope):**
- Snapshot gains `loans` → Task 1. ✓
- `/analyst/debt-plan` structured endpoint, LLM picks strategy/extra/headline/narrative → Tasks 2,4,5. ✓
- Deterministic numbers (interest saved, months sooner, payoff dates, ordering, allocation) → Tasks 3,4. ✓
- LLM never sources money figures (test asserts 999999 ignored) → Task 4. ✓
- Honest fallback `source:"deterministic"` / `available:false` on `LLMError` → Task 4. ✓
- Frontend wiring (`useDebtPlan`) for Phases 1/3 → Task 6. ✓
- Phases 1–3 (overview UI, detail page, persistent coach) are intentionally OUT of this plan; they get their own plans.

**Placeholder scan:** none — every code step has full code; commands have expected output.

**Type consistency:** `DebtPlanOut`/`DebtPlanLLM`/`DebtPlanOrderItem` names match across schemas, service `_assemble_plan`, router, and the hook. `project_total` returns `{months, interest, payoff_date}` consumed consistently in `_assemble_plan`. `_debt_loans` is monkeypatched in tests and defined in the service.

**Risk note:** Task 6 Step 1 depends on the repo's actual codegen script name — the engineer must grep `package.json` and use the real script. If no codegen exists, hand-add the `DebtPlanOut` interface to `api-schema.d.ts` to match the Pydantic model.
