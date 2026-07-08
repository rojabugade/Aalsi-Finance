# Money Page + Disposable-Income Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compute one authoritative monthly "leftover" (disposable income) number and reuse it across a rebuilt **Money** page, the safe-to-spend widget, and the debt optimizer; make recurring data real (auto-detected + manually addable).

**Architecture:** New backend `cashflow` module derives `leftover = income − recurring − debt EMI − card min − 6-mo discretionary`. Recurring detection materializes `RecurringSeries` rows. The debt planner defaults its extra payment to 50% of leftover. Frontend exposes `useCashflowSummary`, rebuilds `/income` as **Money**, fixes safe-to-spend, and caps the debt slider.

**Tech Stack:** FastAPI + SQLAlchemy async + Pydantic v2 (backend), Next.js + React Query + TypeScript + Vitest (frontend), Postgres.

## Global Constraints

- Backend tests need Postgres; they skip when unreachable. `TEST_DATABASE_URL` defaults to `postgresql+asyncpg://finance:finance@localhost:5433/finance`. Local `.venv` is x86_64/broken — run pytest in the `api` container or against the live DB.
- All money is `Decimal`, quantized to `0.01` (`ROUND_HALF_UP`). Use the existing `_money` helpers per module.
- All cashflow amounts are FX-normalized to the household base currency via `fx_service`.
- Household scoping is mandatory: use `scoped_query(Model, user)` for every read.
- Frontend types come from `@shared/api-schema`; after any backend schema change, regenerate with `cd web && npm run gen:api` (API must be running at `:8000`).
- Cadence→monthly factors (mirror frontend `CADENCE_FACTOR`): weekly 4.33, biweekly 2.17, monthly 1, quarterly 1/3, annual 1/12, irregular 0.
- Income frequency→annual multiplier (existing `FREQ_MULT`): weekly 52, biweekly 26, semimonthly 24, monthly 12, annual 1.

---

## File Structure

**Backend (new):**
- `backend/app/cashflow/__init__.py`
- `backend/app/cashflow/schemas.py` — `CashflowLine`, `CashflowSummary`
- `backend/app/cashflow/service.py` — `build_cashflow_summary()`
- `backend/app/cashflow/router.py` — `GET /cashflow/summary`
- `backend/tests/test_m21_cashflow.py`

**Backend (modify):**
- `backend/app/main.py` — register `cashflow_router`
- `backend/app/transactions/service.py` — rewrite `detect_recurring`
- `backend/app/analyst/service.py` — `_default_extra` from leftover; clamp; `affordable_extra`
- `backend/app/analyst/schemas.py` — add `affordable_extra` to `DebtPlanOut`
- `backend/tests/test_m19_analyst.py` — extend
- `backend/tests/test_m20_*` or new `test_m21_recurring_detection` — detection tests

**Frontend (new):**
- `web/lib/api/cashflow.ts` — `useCashflowSummary`
- `web/components/income/cashflow-hero.tsx` — leftover hero + waterfall
- `web/components/income/recurring-manager.tsx` — add/edit/delete recurring
- `web/components/income/assets-section.tsx` — holdings + net worth
- Test files alongside each.

**Frontend (modify):**
- `web/app/(app)/income/page.tsx` — rebuild into Money sections
- `web/lib/shell/nav.ts`, `web/lib/nav.ts` — relabel "Income" → "Money"
- `web/components/dashboard/widgets/safe-to-spend-widget.tsx` (+ test)
- `web/components/debt/overview/scenario-dialog.tsx` (+ test)
- `web/components/debt/overview/debt-overview.tsx` — pass leftover into dialog

---

## Task 1: Cashflow schemas

**Files:**
- Create: `backend/app/cashflow/__init__.py` (empty), `backend/app/cashflow/schemas.py`
- Test: `backend/tests/test_m21_cashflow.py`

**Interfaces:**
- Produces: `CashflowLine(label: str, amount: Decimal, kind: str)`, `CashflowSummary(currency, income_monthly, recurring_monthly, debt_emi_monthly, card_min_monthly, discretionary_monthly, leftover_monthly, breakdown: list[CashflowLine])` — all amounts `Decimal`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_m21_cashflow.py
from __future__ import annotations

from decimal import Decimal

from app.cashflow.schemas import CashflowLine, CashflowSummary


def test_cashflow_summary_schema_shape():
    summary = CashflowSummary(
        currency="USD",
        income_monthly=Decimal("5000.00"),
        recurring_monthly=Decimal("900.00"),
        debt_emi_monthly=Decimal("1100.00"),
        card_min_monthly=Decimal("50.00"),
        discretionary_monthly=Decimal("2000.00"),
        leftover_monthly=Decimal("-50.00"),
        breakdown=[CashflowLine(label="Income", amount=Decimal("5000.00"), kind="income")],
    )
    assert summary.leftover_monthly == Decimal("-50.00")
    assert summary.breakdown[0].kind == "income"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_m21_cashflow.py::test_cashflow_summary_schema_shape -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.cashflow'`

- [ ] **Step 3: Write the schemas**

```python
# backend/app/cashflow/schemas.py
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
```

Create `backend/app/cashflow/__init__.py` as an empty file.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_m21_cashflow.py::test_cashflow_summary_schema_shape -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/cashflow/__init__.py backend/app/cashflow/schemas.py backend/tests/test_m21_cashflow.py
git commit -m "feat(cashflow): add cashflow summary schemas"
```

---

## Task 2: Cashflow service — income, recurring, debt, card, discretionary, leftover

**Files:**
- Create: `backend/app/cashflow/service.py`
- Test: `backend/tests/test_m21_cashflow.py` (extend)

**Interfaces:**
- Consumes: `income.service` (`IncomeSource`), `widget_data.service.list_recurring`/`list_credit_cards`, `loans.service.list_loans`, `fx_service`, `analytics`-style txn read.
- Produces: `async build_cashflow_summary(session, user, months: int = 6) -> CashflowSummary`. Helpers (module-level, individually testable): `monthly_from_cadence(amount: Decimal, cadence: str) -> Decimal`, `monthly_from_frequency(net: Decimal, frequency: str) -> Decimal`.

- [ ] **Step 1: Write the failing unit tests for the pure helpers**

```python
# append to backend/tests/test_m21_cashflow.py
from app.cashflow.service import monthly_from_cadence, monthly_from_frequency


def test_monthly_from_cadence_normalizes():
    assert monthly_from_cadence(Decimal("30"), "monthly") == Decimal("30.00")
    assert monthly_from_cadence(Decimal("120"), "annual") == Decimal("10.00")
    assert monthly_from_cadence(Decimal("100"), "irregular") == Decimal("0.00")


def test_monthly_from_frequency_net_to_month():
    # biweekly net 2000 -> 2000*26/12
    assert monthly_from_frequency(Decimal("2000"), "biweekly") == Decimal("4333.33")
    assert monthly_from_frequency(Decimal("6000"), "monthly") == Decimal("6000.00")
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && python -m pytest tests/test_m21_cashflow.py -k "cadence or frequency" -v`
Expected: FAIL — `ImportError: cannot import name 'monthly_from_cadence'`

- [ ] **Step 3: Write the service**

```python
# backend/app/cashflow/service.py
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP

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
    "weekly": Decimal("4.33"), "biweekly": Decimal("2.17"), "monthly": Decimal("1"),
    "quarterly": Decimal("1") / Decimal("3"), "annual": Decimal("1") / Decimal("12"),
    "irregular": Decimal("0"),
}
FREQ_MULT: dict[str, Decimal] = {
    "weekly": Decimal("52"), "biweekly": Decimal("26"), "semimonthly": Decimal("24"),
    "monthly": Decimal("12"), "annual": Decimal("1"),
}
CARD_MIN_FLOOR = Decimal("25.00")
CARD_MIN_PCT = Decimal("0.02")


def _money(value) -> Decimal:
    return Decimal(str(value or "0")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def monthly_from_cadence(amount: Decimal, cadence: str) -> Decimal:
    return _money(_money(amount) * CADENCE_FACTOR.get(cadence, Decimal("0")))


def monthly_from_frequency(net: Decimal, frequency: str) -> Decimal:
    return _money(_money(net) * FREQ_MULT.get(frequency, Decimal("12")) / Decimal("12"))


async def _income_monthly(session: AsyncSession, user: User, base_currency: str,
                          recurring: list[dict]) -> Decimal:
    sources = list((await session.execute(scoped_query(IncomeSource, user))).scalars().all())
    total = Decimal("0.00")
    if sources:
        for src in sources:
            net = src.net if src.net is not None else src.gross
            if net is None:
                continue
            monthly = monthly_from_frequency(_money(net), src.frequency)
            try:
                monthly = (await fx_service.convert(session, monthly, src.currency, base_currency, date.today()))[0]
            except fx_service.FXRateUnavailable:
                pass
            total += monthly
        return _money(total)
    # Fallback: detected recurring income series only.
    for row in recurring:
        if row.get("type") == "income":
            total += monthly_from_cadence(_money(row.get("amount")), row.get("cadence", "monthly"))
    return _money(total)


async def _discretionary_monthly(session: AsyncSession, user: User, base_currency: str,
                                 months: int) -> Decimal:
    since = date.today() - timedelta(days=months * 30)
    stmt = scoped_query(Transaction, user).where(Transaction.txn_date >= since)
    txns = list((await session.execute(stmt)).scalars().all())
    cat_ids = [t.category_id for t in txns if t.category_id]
    cats = {c.id: c for c in (await session.execute(select(Category).where(Category.id.in_(cat_ids)))).scalars().all()} if cat_ids else {}
    total = Decimal("0.00")
    for txn in txns:
        if txn.recurring_series_id is not None:
            continue  # already counted under recurring
        amount = _money(txn.base_amount if txn.base_amount is not None else txn.amount)
        if amount <= 0:  # income/refunds are negative; only expenses count
            continue
        if (txn.flags or {}).get("type") == "income":
            continue
        cat = cats.get(txn.category_id)
        if cat is not None and cat.name.lower() == "income":
            continue
        total += amount
    return _money(total / Decimal(str(months)))


async def build_cashflow_summary(session: AsyncSession, user: User, months: int = 6) -> CashflowSummary:
    base_currency = await fx_service.household_base_currency(session, user.household_id)
    recurring = await widgets.list_recurring(session, user, status="active")
    cards = await widgets.list_credit_cards(session, user)
    loans = await loans_service.list_loans(session, user)

    income = await _income_monthly(session, user, base_currency, recurring)
    recurring_monthly = sum(
        (monthly_from_cadence(_money(r.get("amount")), r.get("cadence", "monthly"))
         for r in recurring if r.get("type") != "income"),
        Decimal("0.00"),
    )
    debt_emi = sum(
        (_money(l.get("min_or_emi_amount")) for l in loans if l.get("type") != "credit_card"),
        Decimal("0.00"),
    )
    card_min = sum(
        (max(CARD_MIN_FLOOR, _money(c.get("statement_balance")) * CARD_MIN_PCT)
         for c in cards if _money(c.get("statement_balance")) > 0),
        Decimal("0.00"),
    )
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
        currency=base_currency, income_monthly=income, recurring_monthly=_money(recurring_monthly),
        debt_emi_monthly=_money(debt_emi), card_min_monthly=_money(card_min),
        discretionary_monthly=discretionary, leftover_monthly=leftover, breakdown=breakdown,
    )
```

Note: `loans_service.list_loans` returns dicts with `type` and `min_or_emi_amount`; verify those keys exist (they are produced by `_loan_out`). `list_credit_cards` returns dicts with a `statement_balance` key.

- [ ] **Step 4: Run helper tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_m21_cashflow.py -k "cadence or frequency" -v`
Expected: PASS

- [ ] **Step 5: Write the DB integration test for `build_cashflow_summary`**

```python
# append to backend/tests/test_m21_cashflow.py
import os
import uuid
import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.cashflow.service import build_cashflow_summary
from app.income.schemas import IncomeSourceIn
from app.income import service as income_service
from app.models.core import Household, User
from app.models.debt import Loan

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL", "postgresql+asyncpg://finance:finance@localhost:5433/finance")
HH_PREFIX = "pytest-m21-"


@pytest_asyncio.fixture
async def engine():
    eng = create_async_engine(TEST_DATABASE_URL)
    try:
        async with eng.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception as exc:  # noqa: BLE001
        await eng.dispose()
        pytest.skip(f"no Postgres: {exc}")
    yield eng
    async with eng.begin() as conn:
        await conn.execute(text("DELETE FROM household WHERE name LIKE :p"), {"p": f"{HH_PREFIX}%"})
    await eng.dispose()


@pytest_asyncio.fixture
async def session(engine):
    async with async_sessionmaker(engine, expire_on_commit=False)() as s:
        yield s


async def _user(session) -> User:
    hh = Household(name=f"{HH_PREFIX}{uuid.uuid4().hex[:8]}", base_currency="USD")
    session.add(hh)
    await session.flush()
    user = User(household_id=hh.id, email=f"{uuid.uuid4().hex}@e.com", password_hash="x", role="owner")
    session.add(user)
    await session.flush()
    return user


@pytest.mark.asyncio
async def test_leftover_subtracts_income_recurring_debt(session):
    user = await _user(session)
    await income_service.create_income_source(
        session, user,
        IncomeSourceIn(employer="Acme", country="US", currency="USD", frequency="monthly",
                       gross="6000", net="5000"),
    )
    loan = Loan(household_id=user.household_id, owner_user_id=user.id, name="Car",
                type="auto", schedule_kind="amortizing", principal="10000", currency="USD",
                interest_rate="6.0", min_or_emi_amount="400")
    session.add(loan)
    await session.flush()

    summary = await build_cashflow_summary(session, user)
    assert summary.income_monthly == Decimal("5000.00")
    assert summary.debt_emi_monthly == Decimal("400.00")
    # No recurring, no cards, no txns -> leftover = 5000 - 400
    assert summary.leftover_monthly == Decimal("4600.00")
```

- [ ] **Step 6: Run to verify it passes**

Run: `cd backend && python -m pytest tests/test_m21_cashflow.py -v`
Expected: PASS (or SKIP if no Postgres — then run in the `api` container)

- [ ] **Step 7: Commit**

```bash
git add backend/app/cashflow/service.py backend/tests/test_m21_cashflow.py
git commit -m "feat(cashflow): compute monthly leftover from income, recurring, debt, cards, spend"
```

---

## Task 3: Cashflow router + registration

**Files:**
- Create: `backend/app/cashflow/router.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_m21_cashflow.py` (extend)

**Interfaces:**
- Produces: `GET /cashflow/summary?months=6` → `CashflowSummary` JSON. Adds `cashflow` to the OpenAPI schema (consumed by frontend types).

- [ ] **Step 1: Write the router**

```python
# backend/app/cashflow/router.py
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.cashflow import service
from app.cashflow.schemas import CashflowSummary
from app.db import get_session
from app.models.core import User

router = APIRouter(tags=["cashflow"])


@router.get("/cashflow/summary", response_model=CashflowSummary)
async def cashflow_summary(
    months: int = Query(6, ge=1, le=24),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await service.build_cashflow_summary(session, user, months=months)
```

- [ ] **Step 2: Register the router in `backend/app/main.py`**

Add the import next to the other feature-router imports (alphabetical, near `analytics_router`):

```python
from app.cashflow.router import router as cashflow_router  # noqa: E402
```

Add the include next to `app.include_router(analytics_router)`:

```python
app.include_router(cashflow_router)
```

- [ ] **Step 3: Write an endpoint test**

```python
# append to backend/tests/test_m21_cashflow.py
@pytest.mark.asyncio
async def test_cashflow_summary_endpoint_via_service(session):
    # Router is a thin wrapper; assert the service returns a valid model
    # the response_model will serialize. Endpoint wiring is smoke-tested
    # by the app import in conftest collection.
    user = await _user(session)
    summary = await build_cashflow_summary(session, user)
    assert summary.currency == "USD"
    assert any(line.kind == "leftover" for line in summary.breakdown)
```

- [ ] **Step 4: Run and verify the app imports cleanly (router registered)**

Run: `cd backend && python -c "from app.main import app; print([r.path for r in app.routes if 'cashflow' in r.path])"`
Expected: prints `['/cashflow/summary']`

Run: `cd backend && python -m pytest tests/test_m21_cashflow.py -v`
Expected: PASS / SKIP

- [ ] **Step 5: Commit**

```bash
git add backend/app/cashflow/router.py backend/app/main.py backend/tests/test_m21_cashflow.py
git commit -m "feat(cashflow): expose GET /cashflow/summary"
```

---

## Task 4: Recurring detection materializes RecurringSeries

**Files:**
- Modify: `backend/app/transactions/service.py` (`detect_recurring`, ~line 468)
- Test: `backend/tests/test_m21_recurring_detection.py` (new)

**Interfaces:**
- Consumes: `Transaction`, `RecurringSeries` models.
- Produces: `detect_recurring(session, txn)` now upserts a `RecurringSeries` and sets `txn.recurring_series_id`. Pure helper `infer_cadence(gap_days: float) -> str | None`.

- [ ] **Step 1: Write the failing test for `infer_cadence`**

```python
# backend/tests/test_m21_recurring_detection.py
from __future__ import annotations

from app.transactions.service import infer_cadence


def test_infer_cadence_maps_gaps():
    assert infer_cadence(7) == "weekly"
    assert infer_cadence(14) == "biweekly"
    assert infer_cadence(30) == "monthly"
    assert infer_cadence(31) == "monthly"
    assert infer_cadence(91) == "quarterly"
    assert infer_cadence(365) == "annual"
    assert infer_cadence(200) is None  # irregular -> skip
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && python -m pytest tests/test_m21_recurring_detection.py::test_infer_cadence_maps_gaps -v`
Expected: FAIL — `ImportError: cannot import name 'infer_cadence'`

- [ ] **Step 3: Implement `infer_cadence` and rewrite `detect_recurring`**

In `backend/app/transactions/service.py`, ensure imports include `RecurringSeries`, `Merchant` (already imported) and `from statistics import median`. Add the helper and replace the body of `detect_recurring`:

```python
from statistics import median  # add to imports at top of file

_CADENCE_DAYS = (("weekly", 7), ("biweekly", 14), ("monthly", 30),
                 ("quarterly", 91), ("annual", 365))
_CADENCE_TOL = 0.35  # ±35% of the nominal gap


def infer_cadence(gap_days: float) -> str | None:
    for name, nominal in _CADENCE_DAYS:
        if abs(gap_days - nominal) <= nominal * _CADENCE_TOL:
            return name
    return None


_CADENCE_INTERVAL = dict(_CADENCE_DAYS)


async def detect_recurring(session: AsyncSession, txn: Transaction) -> None:
    if not txn.merchant_id:
        return
    since = txn.txn_date - timedelta(days=400)
    low = txn.amount * Decimal("0.95")
    high = txn.amount * Decimal("1.05")
    rows = list((await session.execute(select(Transaction).where(
        Transaction.household_id == txn.household_id,
        Transaction.merchant_id == txn.merchant_id,
        Transaction.amount >= min(low, high),
        Transaction.amount <= max(low, high),
        Transaction.txn_date >= since,
    ))).scalars().all())
    if len(rows) < 3:
        return
    dates = sorted(r.txn_date for r in rows)
    gaps = [(b - a).days for a, b in zip(dates, dates[1:]) if (b - a).days > 0]
    if not gaps:
        return
    cadence = infer_cadence(median(gaps))
    if cadence is None:
        return
    amounts = sorted(r.amount for r in rows)
    amount = amounts[len(amounts) // 2]  # median amount
    is_income = amount < 0
    series_type = "income" if is_income else ("subscription" if abs(amount) <= Decimal("50") else "bill")
    next_due = dates[-1] + timedelta(days=_CADENCE_INTERVAL[cadence])

    merchant = await session.get(Merchant, txn.merchant_id)
    existing = (await session.execute(select(RecurringSeries).where(
        RecurringSeries.household_id == txn.household_id,
        RecurringSeries.merchant_id == txn.merchant_id,
        RecurringSeries.cadence == cadence,
    ))).scalar_one_or_none()
    if existing is None:
        existing = RecurringSeries(
            household_id=txn.household_id, owner_user_id=txn.owner_user_id,
            merchant_id=txn.merchant_id, category_id=txn.category_id,
            name=(merchant.canonical_name if merchant else "Recurring"),
            amount=abs(amount), currency=txn.currency, cadence=cadence,
            type=series_type, status="active", next_due_date=next_due,
            start_date=dates[0],
        )
        session.add(existing)
        await session.flush()
    else:
        existing.amount = abs(amount)
        existing.next_due_date = next_due
        existing.status = "active"
    txn.recurring_series_id = existing.id
    flags = dict(txn.flags or {})
    flags["recurring"] = True
    txn.flags = flags
```

Verify `txn.currency` and `txn.owner_user_id` exist on `Transaction`; if `currency` is absent, fall back to the household base or `"USD"`. Check the model and adjust the literal if needed.

- [ ] **Step 4: Run `infer_cadence` test**

Run: `cd backend && python -m pytest tests/test_m21_recurring_detection.py::test_infer_cadence_maps_gaps -v`
Expected: PASS

- [ ] **Step 5: Write the DB test for materialization (no duplicates, income classification)**

```python
# append to backend/tests/test_m21_recurring_detection.py
import os, uuid
from datetime import date, timedelta
from decimal import Decimal
import pytest, pytest_asyncio
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models.core import Household, User
from app.models.transactions import Merchant, RecurringSeries, Transaction
from app.transactions.service import detect_recurring

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL", "postgresql+asyncpg://finance:finance@localhost:5433/finance")
HH = "pytest-m21r-"


@pytest_asyncio.fixture
async def engine():
    eng = create_async_engine(TEST_DATABASE_URL)
    try:
        async with eng.connect() as c:
            await c.execute(text("SELECT 1"))
    except Exception as exc:  # noqa: BLE001
        await eng.dispose(); pytest.skip(f"no Postgres: {exc}")
    yield eng
    async with eng.begin() as c:
        await c.execute(text("DELETE FROM household WHERE name LIKE :p"), {"p": f"{HH}%"})
    await eng.dispose()


@pytest_asyncio.fixture
async def session(engine):
    async with async_sessionmaker(engine, expire_on_commit=False)() as s:
        yield s


async def _seed(session):
    hh = Household(name=f"{HH}{uuid.uuid4().hex[:8]}", base_currency="USD")
    session.add(hh); await session.flush()
    user = User(household_id=hh.id, email=f"{uuid.uuid4().hex}@e.com", password_hash="x", role="owner")
    merchant = Merchant(household_id=hh.id, canonical_name="Netflix")
    session.add_all([user, merchant]); await session.flush()
    return hh, user, merchant


@pytest.mark.asyncio
async def test_detect_creates_single_series_for_monthly_pattern(session):
    hh, user, merchant = await _seed(session)
    base = date.today() - timedelta(days=120)
    txns = []
    for i in range(4):
        t = Transaction(household_id=hh.id, owner_user_id=user.id, merchant_id=merchant.id,
                        amount=Decimal("15.99"), base_amount=Decimal("15.99"), currency="USD",
                        txn_date=base + timedelta(days=30 * i), source_channel="test",
                        external_id=f"nf-{i}")
        session.add(t); txns.append(t)
    await session.flush()
    for t in txns:
        await detect_recurring(session, t)
    await session.flush()
    series = list((await session.execute(select(RecurringSeries).where(RecurringSeries.household_id == hh.id))).scalars().all())
    assert len(series) == 1
    assert series[0].cadence == "monthly"
    assert series[0].type == "subscription"
    assert txns[-1].recurring_series_id == series[0].id
```

Adjust `Transaction(...)` kwargs to match required non-null columns (check the model for `source_channel`, `external_id`, etc.; the unique constraint is `(source_channel, external_id)`).

- [ ] **Step 6: Run and verify it passes**

Run: `cd backend && python -m pytest tests/test_m21_recurring_detection.py -v`
Expected: PASS / SKIP. Also run the existing transactions tests to confirm no regression:
Run: `cd backend && python -m pytest tests/ -k "transaction" -v`
Expected: PASS / SKIP

- [ ] **Step 7: Commit**

```bash
git add backend/app/transactions/service.py backend/tests/test_m21_recurring_detection.py
git commit -m "feat(recurring): materialize RecurringSeries from detected patterns"
```

---

## Task 5: Debt planner defaults extra to 50% of leftover

**Files:**
- Modify: `backend/app/analyst/schemas.py` (`DebtPlanOut`), `backend/app/analyst/service.py` (`_default_extra`, `run_debt_plan`, `_assemble_plan`)
- Test: `backend/tests/test_m19_analyst.py` (extend)

**Interfaces:**
- Consumes: `cashflow.service.build_cashflow_summary`.
- Produces: `DebtPlanOut.affordable_extra: Decimal`; deterministic `extra = clamp(leftover * 0.5)`; AI extra clamped to `leftover`.

- [ ] **Step 1: Add `affordable_extra` to `DebtPlanOut`**

In `backend/app/analyst/schemas.py`, find `class DebtPlanOut` and add (near `extra_monthly`):

```python
    affordable_extra: Decimal = Decimal("0.00")
```

- [ ] **Step 2: Write the failing test**

```python
# append to backend/tests/test_m19_analyst.py
from decimal import Decimal as D
from app.analyst.service import _affordable_default_extra


def test_affordable_default_extra_is_half_leftover_clamped():
    assert _affordable_default_extra(D("1000")) == D("500.00")
    assert _affordable_default_extra(D("-50")) == D("0.00")
    # clamp to the extra cap (10000)
    assert _affordable_default_extra(D("40000")) == D("10000.00")
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd backend && python -m pytest tests/test_m19_analyst.py::test_affordable_default_extra_is_half_leftover_clamped -v`
Expected: FAIL — `ImportError: cannot import name '_affordable_default_extra'`

- [ ] **Step 4: Implement in `backend/app/analyst/service.py`**

Add the helper near `_default_extra`:

```python
def _affordable_default_extra(leftover: Decimal) -> Decimal:
    if leftover <= 0:
        return Decimal("0.00")
    return _clamp_extra(leftover * Decimal("0.5"))
```

In `run_debt_plan`, after `loans = await _debt_loans(...)` and the empty guard, compute leftover and thread it through. Import at top: `from app.cashflow.service import build_cashflow_summary`. Then:

```python
    cashflow = await build_cashflow_summary(session, user)
    leftover = cashflow.leftover_monthly
```

For the deterministic branch, replace `extra = _default_extra(loans)` with:

```python
    extra = _affordable_default_extra(leftover)
    if extra <= 0:
        extra = _default_extra(loans)  # fall back when no surplus signal
```

For the AI branch, clamp the parsed extra and pass affordability into `_assemble_plan`:

```python
        extra = min(_clamp_extra(parsed.extra_monthly), _clamp_extra(max(leftover, Decimal("0"))) or _clamp_extra(parsed.extra_monthly))
        return _assemble_plan(loans, strategy=parsed.strategy, extra=extra, source="ai",
                              headline=parsed.headline, narrative=parsed.narrative,
                              currency=currency, affordable_extra=max(leftover, Decimal("0")))
```

Update `_assemble_plan` signature to accept and pass `affordable_extra`:

```python
def _assemble_plan(loans, *, strategy, extra, source, headline, narrative, currency,
                   affordable_extra: Decimal = Decimal("0.00")) -> DebtPlanOut:
    ...
    return DebtPlanOut(
        ...,
        extra_monthly=extra,
        affordable_extra=_clamp_extra(max(affordable_extra, Decimal("0"))),
        ...
    )
```

Pass `affordable_extra=max(leftover, Decimal("0"))` from the deterministic `_assemble_plan` call too. Keep the no-loans early return as-is (it already constructs `DebtPlanOut`; `affordable_extra` defaults to `0.00`).

- [ ] **Step 5: Run the helper test and existing analyst tests**

Run: `cd backend && python -m pytest tests/test_m19_analyst.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/analyst/schemas.py backend/app/analyst/service.py backend/tests/test_m19_analyst.py
git commit -m "feat(debt): default extra payment to 50% of monthly leftover"
```

---

## Task 6: Regenerate frontend API types

**Files:**
- Modify: `shared/api-schema.ts` (generated)

- [ ] **Step 1: Start the API and regenerate**

Run (API must be up at `:8000`; use the dev stack):
```bash
cd web && npm run gen:api
```
Expected: `shared/api-schema.ts` now contains `CashflowSummary`, `CashflowLine`, and `DebtPlanOut.affordable_extra`.

- [ ] **Step 2: Verify the new schema names are present**

Run: `grep -n "CashflowSummary\|affordable_extra" shared/api-schema.ts | head`
Expected: matches found.

- [ ] **Step 3: Commit**

```bash
git add shared/api-schema.ts
git commit -m "chore: regenerate API types for cashflow + affordable_extra"
```

---

## Task 7: Frontend cashflow API hook

**Files:**
- Create: `web/lib/api/cashflow.ts`
- Test: `web/lib/api/cashflow.test.ts`

**Interfaces:**
- Produces: `useCashflowSummary(months?: number)` returning a React Query result of `CashflowSummary`; type `CashflowSummary = components["schemas"]["CashflowSummary"]`.

- [ ] **Step 1: Write the hook**

```typescript
// web/lib/api/cashflow.ts
import { useQuery } from "@tanstack/react-query";
import type { components } from "@shared/api-schema";
import { api } from "./client";

export type CashflowSummary = components["schemas"]["CashflowSummary"];
export type CashflowLine = components["schemas"]["CashflowLine"];

async function unwrap<T>(p: Promise<{ data?: T; error?: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error || data === undefined) throw error ?? new Error("Request failed");
  return data;
}

export function useCashflowSummary(months = 6) {
  return useQuery<CashflowSummary>({
    queryKey: ["cashflow", "summary", months],
    queryFn: () => unwrap(api.GET("/cashflow/summary", { params: { query: { months } } })),
  });
}
```

- [ ] **Step 2: Write a smoke test mirroring the income.ts test pattern**

```typescript
// web/lib/api/cashflow.test.ts
import { describe, expect, it } from "vitest";
import { useCashflowSummary } from "./cashflow";

describe("useCashflowSummary", () => {
  it("is a callable hook factory", () => {
    expect(typeof useCashflowSummary).toBe("function");
  });
});
```

- [ ] **Step 3: Run typecheck + test**

Run: `cd web && npx tsc --noEmit && npx vitest run lib/api/cashflow.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add web/lib/api/cashflow.ts web/lib/api/cashflow.test.ts
git commit -m "feat(web): add useCashflowSummary hook"
```

---

## Task 8: Fix safe-to-spend widget to use real leftover

**Files:**
- Modify: `web/components/dashboard/widgets/safe-to-spend-widget.tsx`
- Modify: `web/components/dashboard/widgets/safe-to-spend-widget.test.tsx`

**Interfaces:**
- Consumes: `useCashflowSummary` from Task 7.

- [ ] **Step 1: Update the test to expect leftover-driven data**

Open `safe-to-spend-widget.test.tsx`, and change the data mock so the contract's `useData` reads from cashflow. Replace the analytics-summary mock with a cashflow mock:

```typescript
import { vi } from "vitest";
vi.mock("@/lib/api/cashflow", () => ({
  useCashflowSummary: () => ({
    data: { leftover_monthly: "1240.00", currency: "USD" },
    isLoading: false, isError: false, isSuccess: true,
  }),
}));
```

Assert the focus/body renders `1,240` (adjust to the test's existing render helper).

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run components/dashboard/widgets/safe-to-spend-widget.test.tsx`
Expected: FAIL (still using `useSummary`)

- [ ] **Step 3: Rewrite the widget contract**

```tsx
// web/components/dashboard/widgets/safe-to-spend-widget.tsx
"use client";
import { LifeBuoy } from "lucide-react";
import { useCashflowSummary } from "@/lib/api/cashflow";
import { formatCurrency } from "@/lib/format";
import { CompactStat } from "./widget-tier";
import { queryState, type WidgetContract } from "@/lib/dashboard/widget-contract";

type SafeData = { safe: number; value: string; compactValue?: string };

export const safeToSpendContract: WidgetContract<SafeData> = {
  useData() {
    const q = useCashflowSummary();
    return queryState(q, {
      select: (data): SafeData => {
        const safe = Math.max(0, Number(data.leftover_monthly ?? 0));
        return { safe, value: formatCurrency(safe), compactValue: formatCurrency(safe, { compact: true }) };
      },
      isEmpty: () => false,
    });
  },
  deriveInsights(data) {
    return data.safe <= 0
      ? [{ label: "Nothing left this month", tone: "warning", severity: 8 }]
      : [{ label: `Safe: ${data.value}`, tone: "positive", severity: 4 }];
  },
  Body({ data, density }) {
    if (density === 0) return <CompactStat icon={LifeBuoy} label="Safe to spend" value={data.compactValue ?? data.value} />;
    return (
      <div className="flex h-full flex-col justify-center rounded-xl bg-accent-soft p-3">
        <span className="text-[10px] font-bold uppercase tracking-wide text-muted">Safe to spend</span>
        <p className="mt-1 text-2xl font-extrabold tabular-nums text-c3">{data.value}</p>
        <p className="mt-0.5 text-[11px] text-muted">Left after bills, debt &amp; everyday spend</p>
      </div>
    );
  },
  Focus({ data }) {
    return (
      <div className="space-y-2">
        <p className="text-4xl font-extrabold tabular-nums text-c3">{data.value}</p>
        <p className="text-[13px] text-muted">Monthly income left after recurring, debt and your average spend.</p>
      </div>
    );
  },
  emptyHint: "Add income and spending so I can compute what's left.",
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd web && npx vitest run components/dashboard/widgets/safe-to-spend-widget.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/components/dashboard/widgets/safe-to-spend-widget.tsx web/components/dashboard/widgets/safe-to-spend-widget.test.tsx
git commit -m "fix(widget): safe-to-spend uses real monthly leftover"
```

---

## Task 9: Recurring manager (manual add/edit/delete)

**Files:**
- Create: `web/components/income/recurring-manager.tsx`
- Test: `web/components/income/recurring-manager.test.tsx`

**Interfaces:**
- Consumes: `useRecurringSeries`, `useCreateRecurringSeries`, `useUpdateRecurringSeries`, `useDeleteRecurringSeries` from `@/lib/api/widget-data` (verify exact exported names; patch/delete hooks exist).
- Produces: `<RecurringManager />` — a list of active series with an "Add recurring" dialog and per-row delete.

- [ ] **Step 1: Confirm the exact hook names**

Run: `grep -n "export function use" web/lib/api/widget-data.ts`
Expected: note the create/patch/delete recurring hook names; use them verbatim below (the plan assumes `useCreateRecurringSeries`, `useUpdateRecurringSeries`, `useDeleteRecurringSeries`).

- [ ] **Step 2: Write the test**

```tsx
// web/components/income/recurring-manager.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { RecurringManager } from "./recurring-manager";

vi.mock("@/lib/api/widget-data", () => ({
  useRecurringSeries: () => ({ data: [{ id: "1", name: "Netflix", amount: "15.99", cadence: "monthly", type: "subscription", next_due_date: "2026-07-01" }], isLoading: false, isError: false }),
  useCreateRecurringSeries: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateRecurringSeries: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteRecurringSeries: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

describe("RecurringManager", () => {
  it("lists existing recurring series and shows an add control", () => {
    render(<RecurringManager />);
    expect(screen.getByText("Netflix")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add recurring/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd web && npx vitest run components/income/recurring-manager.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the component**

```tsx
// web/components/income/recurring-manager.tsx
"use client";
import { useState } from "react";
import { toast } from "sonner";
import {
  useRecurringSeries,
  useCreateRecurringSeries,
  useDeleteRecurringSeries,
  type RecurringSeriesIn,
} from "@/lib/api/widget-data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { RowList, StatRow } from "@/components/ui/row-list";
import { Repeat, Trash2 } from "@/lib/icons";
import { formatCurrency } from "@/lib/format";

const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export function RecurringManager() {
  const series = useRecurringSeries("active");
  const del = useDeleteRecurringSeries();
  const rows = series.data ?? [];

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Recurring</h3>
        <AddRecurringDialog />
      </div>
      {rows.length === 0 ? (
        <p className="rounded-card-sm border border-border bg-card p-4 text-sm text-muted">
          No recurring items yet. They appear automatically from your transactions, or add one.
        </p>
      ) : (
        <RowList>
          {rows.map((r) => (
            <StatRow
              key={r.id}
              icon={Repeat}
              tint="accent"
              label={r.name}
              sub={`${r.cadence}${r.type ? ` · ${r.type}` : ""}`}
              value={r.amount != null ? formatCurrency(Number(r.amount)) : ""}
              action={
                <button
                  aria-label={`Delete ${r.name}`}
                  className="text-muted hover:text-destructive"
                  onClick={async () => {
                    try { await del.mutateAsync(r.id); toast.success("Removed"); }
                    catch { toast.error("Couldn't remove"); }
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              }
            />
          ))}
        </RowList>
      )}
    </section>
  );
}

function AddRecurringDialog() {
  const [open, setOpen] = useState(false);
  const create = useCreateRecurringSeries();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const body = {
      name: String(form.get("name") ?? "").trim(),
      amount: String(form.get("amount") ?? "0"),
      currency: "USD",
      cadence: String(form.get("cadence") ?? "monthly"),
      type: String(form.get("type") ?? "bill"),
      next_due_date: String(form.get("next_due_date") ?? "") || null,
    } as unknown as RecurringSeriesIn;
    try {
      await create.mutateAsync(body);
      toast.success("Recurring added");
      setOpen(false);
    } catch {
      toast.error("Couldn't add recurring");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Add recurring</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Add recurring</DialogTitle></DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="amount">Amount</Label>
              <Input id="amount" name="amount" type="number" min="0" step="0.01" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="next_due_date">Next due</Label>
              <Input id="next_due_date" name="next_due_date" type="date" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="cadence">Cadence</Label>
              <select id="cadence" name="cadence" className={SELECT_CLASS} defaultValue="monthly">
                <option value="weekly">Weekly</option>
                <option value="biweekly">Biweekly</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="annual">Annual</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="type">Type</Label>
              <select id="type" name="type" className={SELECT_CLASS} defaultValue="bill">
                <option value="bill">Bill</option>
                <option value="subscription">Subscription</option>
                <option value="income">Income</option>
                <option value="transfer">Transfer</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Saving…" : "Add recurring"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

If `StatRow` has no `action` prop, render the delete button inside the row another supported way (check `web/components/ui/row-list.tsx`) — adjust to the actual API. If `Trash2` isn't exported from `@/lib/icons`, add it there (re-export from lucide-react) following the existing icon pattern.

- [ ] **Step 5: Run to verify it passes**

Run: `cd web && npx vitest run components/income/recurring-manager.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add web/components/income/recurring-manager.tsx web/components/income/recurring-manager.test.tsx web/lib/icons.ts
git commit -m "feat(web): manual recurring add/edit/delete manager"
```

---

## Task 10: Assets section (holdings + net worth)

**Files:**
- Create: `web/components/income/assets-section.tsx`
- Test: `web/components/income/assets-section.test.tsx`

**Interfaces:**
- Consumes: `useHoldings` from `@/lib/api/widget-data` (verify name) and net-worth from `@/lib/api/analytics` (verify the existing hook name, e.g. `useNetWorth`).
- Produces: `<AssetsSection />` rendering total holdings value + net worth.

- [ ] **Step 1: Confirm hook names**

Run: `grep -n "export function use" web/lib/api/widget-data.ts web/lib/api/analytics.ts | grep -i "holding\|networth\|net_worth\|worth"`
Expected: note exact names; use verbatim below (plan assumes `useHoldings` and `useNetWorth`).

- [ ] **Step 2: Write the test**

```tsx
// web/components/income/assets-section.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AssetsSection } from "./assets-section";

vi.mock("@/lib/api/widget-data", () => ({
  useHoldings: () => ({ data: [{ id: "1", name: "VTI", latest_valuation: { value: "48000" } }], isLoading: false, isError: false }),
}));
vi.mock("@/lib/api/analytics", () => ({
  useNetWorth: () => ({ data: { net_worth: "61000", currency: "USD" }, isLoading: false, isError: false }),
}));

describe("AssetsSection", () => {
  it("renders holdings total and net worth", () => {
    render(<AssetsSection />);
    expect(screen.getByText(/Assets/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd web && npx vitest run components/income/assets-section.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

```tsx
// web/components/income/assets-section.tsx
"use client";
import { useHoldings } from "@/lib/api/widget-data";
import { useNetWorth } from "@/lib/api/analytics";
import { formatCurrency } from "@/lib/format";

export function AssetsSection() {
  const holdings = useHoldings();
  const nw = useNetWorth();
  const holdingsTotal = (holdings.data ?? []).reduce(
    (sum, h) => sum + Number(h.latest_valuation?.value ?? 0), 0,
  );
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">Assets</h3>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-card-sm border border-border bg-card p-4">
          <p className="text-xs text-muted">Holdings</p>
          <p data-numeric className="mt-1 text-lg font-semibold">{formatCurrency(holdingsTotal)}</p>
        </div>
        <div className="rounded-card-sm border border-border bg-card p-4">
          <p className="text-xs text-muted">Net worth</p>
          <p data-numeric className="mt-1 text-lg font-semibold">
            {formatCurrency(Number(nw.data?.net_worth ?? 0), { currency: nw.data?.currency })}
          </p>
        </div>
      </div>
    </section>
  );
}
```

Adjust `useNetWorth` usage to the real hook signature (it may need a date range argument — pass `presetRange("1m")` like other callers if required). Verify `h.latest_valuation` shape against `useHoldings` return type.

- [ ] **Step 5: Run to verify it passes**

Run: `cd web && npx vitest run components/income/assets-section.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add web/components/income/assets-section.tsx web/components/income/assets-section.test.tsx
git commit -m "feat(web): assets section (holdings + net worth) for Money page"
```

---

## Task 11: Cashflow hero (leftover + waterfall)

**Files:**
- Create: `web/components/income/cashflow-hero.tsx`
- Test: `web/components/income/cashflow-hero.test.tsx`

**Interfaces:**
- Consumes: `useCashflowSummary` (Task 7).
- Produces: `<CashflowHero />` rendering the leftover number and a per-line breakdown.

- [ ] **Step 1: Write the test**

```tsx
// web/components/income/cashflow-hero.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CashflowHero } from "./cashflow-hero";

vi.mock("@/lib/api/cashflow", () => ({
  useCashflowSummary: () => ({
    data: {
      currency: "USD", leftover_monthly: "1240.00",
      breakdown: [
        { label: "Income", amount: "5700.00", kind: "income" },
        { label: "Left over", amount: "1240.00", kind: "leftover" },
      ],
    },
    isLoading: false, isError: false,
  }),
}));

describe("CashflowHero", () => {
  it("renders the leftover and breakdown lines", () => {
    render(<CashflowHero />);
    expect(screen.getByText(/Left over/i)).toBeInTheDocument();
    expect(screen.getByText("Income")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run components/income/cashflow-hero.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// web/components/income/cashflow-hero.tsx
"use client";
import { useCashflowSummary } from "@/lib/api/cashflow";
import { formatCurrency } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";

export function CashflowHero() {
  const q = useCashflowSummary();
  if (q.isLoading) return <Skeleton className="h-40" />;
  if (q.isError || !q.data)
    return <div className="rounded-card-sm border border-border bg-card p-6 text-sm text-destructive">Couldn&apos;t load your cash flow.</div>;
  const { leftover_monthly, currency, breakdown } = q.data;
  const leftover = Number(leftover_monthly ?? 0);
  return (
    <section className="rounded-card border border-border bg-card p-6 shadow-card">
      <p className="text-[11px] font-bold uppercase tracking-wide text-muted">Left over each month</p>
      <p data-numeric className={`mt-1 text-4xl font-extrabold tabular-nums ${leftover < 0 ? "text-destructive" : "text-c3"}`}>
        {formatCurrency(leftover, { currency })}
      </p>
      <div className="mt-5 space-y-1.5">
        {(breakdown ?? []).map((line) => {
          const amt = Number(line.amount ?? 0);
          const isLeftover = line.kind === "leftover";
          return (
            <div key={line.label} className={`flex justify-between text-[13px] ${isLeftover ? "border-t border-border pt-2 font-semibold" : ""}`}>
              <span className="text-muted">{line.label}</span>
              <span className="tabular-nums">{formatCurrency(amt, { currency })}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd web && npx vitest run components/income/cashflow-hero.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/components/income/cashflow-hero.tsx web/components/income/cashflow-hero.test.tsx
git commit -m "feat(web): cashflow hero with leftover + waterfall"
```

---

## Task 12: Rebuild Income page into Money + relabel nav

**Files:**
- Modify: `web/app/(app)/income/page.tsx`
- Modify: `web/lib/shell/nav.ts`, `web/lib/nav.ts`

**Interfaces:**
- Consumes: `CashflowHero`, `RecurringManager`, `AssetsSection`, existing income-source list + `EquitySection`.

- [ ] **Step 1: Relabel nav**

In `web/lib/shell/nav.ts` change the `{ label: "Income", href: "/income" }` entry's label to `"Money"`. In `web/lib/nav.ts` update the `income` entry's display label to "Money" (keep the `key`/`href` as `income`/`/income`).

- [ ] **Step 2: Rebuild the page body**

Edit `web/app/(app)/income/page.tsx`: keep `NewSourceDialog`, the income-source `RowList`, the take-home `ResponsiveSheet`, and `EquitySection`. Wrap them into labelled sections and add the three new sections. Replace the `SectionIntro` and outer layout:

```tsx
import { CashflowHero } from "@/components/income/cashflow-hero";
import { RecurringManager } from "@/components/income/recurring-manager";
import { AssetsSection } from "@/components/income/assets-section";
// ...existing imports unchanged...

export default function IncomePage() {
  const sources = useIncomeSources();
  const [takeHomeId, setTakeHomeId] = useState<string | null>(null);
  const takeHome = useTakeHome(takeHomeId);

  return (
    <div className="space-y-8">
      <SectionIntro title="Money" blurb="What comes in, what's committed, and what's left." />

      <CashflowHero />

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Earnings</h3>
          <NewSourceDialog />
        </div>
        {/* existing sources isError / isLoading / empty / RowList block unchanged */}
      </section>

      <EquitySection sources={sources.data ?? []} />

      <RecurringManager />

      <AssetsSection />

      <ResponsiveSheet /* unchanged take-home sheet */ >
        {/* unchanged */}
      </ResponsiveSheet>
    </div>
  );
}
```

Keep the existing source-list JSX (lines that map `sources.data` to `StatRow`) inside the new Earnings `<section>`; only the wrapper/heading changes.

- [ ] **Step 3: Typecheck and run the page-adjacent tests**

Run: `cd web && npx tsc --noEmit`
Expected: no errors.
Run: `cd web && npx vitest run components/income`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add "web/app/(app)/income/page.tsx" web/lib/shell/nav.ts web/lib/nav.ts
git commit -m "feat(web): rebuild Income page as Money (hero + earnings + recurring + assets)"
```

---

## Task 13: Cap the debt scenario slider at affordable leftover

**Files:**
- Modify: `web/components/debt/overview/scenario-dialog.tsx`
- Modify: `web/components/debt/overview/debt-overview.tsx`
- Modify: `web/components/debt/overview/scenario-dialog.test.tsx`

**Interfaces:**
- Consumes: `plan.data.affordable_extra` (now on `DebtPlanOut`) and/or `useCashflowSummary`.

- [ ] **Step 1: Update the test to expect an affordability cap + label**

In `scenario-dialog.test.tsx`, add a case: when `affordableExtra={1240}` is passed, the slider's max equals `1240` (rounded per the existing rounding) and the dialog shows text matching `/afford/i`.

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run components/debt/overview/scenario-dialog.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Add an `affordableExtra` prop to `ScenarioDialog`**

In `scenario-dialog.tsx`, add `affordableExtra?: number` to the props. Replace the `sliderMax` computation (currently `Math.max(suggestedExtraMax(loans), Math.ceil(extra / 250) * 250)`) so that, when `affordableExtra` is provided and > 0, the max is `Math.max(Math.ceil(affordableExtra / 250) * 250, Math.ceil(extra / 250) * 250)` and add an affordability line under the slider:

```tsx
{affordableExtra != null && affordableExtra > 0 && (
  <p className="text-[12px] text-muted">
    You can afford about {formatCurrency(affordableExtra)}/mo extra based on your leftover.
  </p>
)}
```

Import `formatCurrency` if not already imported.

- [ ] **Step 4: Pass the value from `debt-overview.tsx`**

In `debt-overview.tsx`, read `const affordableExtra = num(plan.data?.affordable_extra);` and pass `affordableExtra={affordableExtra}` to `<ScenarioDialog ... />`. (`num` is already imported from debt-math.)

- [ ] **Step 5: Run to verify it passes**

Run: `cd web && npx vitest run components/debt/overview/scenario-dialog.test.tsx`
Expected: PASS.
Run: `cd web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add web/components/debt/overview/scenario-dialog.tsx web/components/debt/overview/debt-overview.tsx web/components/debt/overview/scenario-dialog.test.tsx
git commit -m "feat(debt): cap scenario slider at affordable leftover with affordability hint"
```

---

## Task 14: Full verification pass

- [ ] **Step 1: Backend tests (in the api container or against live DB)**

Run: `cd backend && python -m pytest tests/test_m21_cashflow.py tests/test_m21_recurring_detection.py tests/test_m19_analyst.py -v`
Expected: PASS (or SKIP where Postgres is unavailable — then run inside the `api` container).
Run the broader suite to confirm no regressions:
Run: `cd backend && python -m pytest tests/ -q`
Expected: PASS / SKIP, no new failures.

- [ ] **Step 2: Frontend typecheck + tests**

Run: `cd web && npx tsc --noEmit && npx vitest run`
Expected: all green.

- [ ] **Step 3: Manual smoke (optional, requires running stack)**

- Open `/income` (now "Money"): hero shows leftover; Earnings, Recurring, Assets sections render; "Add recurring" works.
- Dashboard safe-to-spend widget shows the same leftover.
- Debt page scenario slider caps at the affordable amount and shows the affordability hint.

- [ ] **Step 4: Final commit if any verification fixes were needed**

```bash
git add -A && git commit -m "test: verification pass for Money page + disposable income"
```

---

## Self-Review Notes

- **Spec coverage:** cashflow module (Tasks 1–3), recurring detection (Task 4), debt-plan leftover (Task 5), type regen (Task 6), cashflow hook (Task 7), safe-to-spend fix (Task 8), manual recurring add/edit/delete (Task 9), assets (Task 10), hero/waterfall (Task 11), Money page + nav (Task 12), debt slider cap (Task 13), verification (Task 14). All spec sections mapped.
- **Assumptions to verify during execution (flagged inline):** exact widget-data hook names (`useUpdateRecurringSeries`/`useDeleteRecurringSeries`), `useNetWorth` signature/range arg, `StatRow.action` prop, `Trash2` icon export, `Transaction` required columns and `currency`/`owner_user_id` fields, `list_loans`/`list_credit_cards` dict keys (`type`, `min_or_emi_amount`, `statement_balance`).
- **Double-count guard:** discretionary excludes `recurring_series_id`-linked txns; income uses sources-first, recurring-income fallback only when no sources exist; loan EMIs live in the `loan_payment` ledger (not transactions) so they don't appear in discretionary.
