# Analyst Memory & Awareness — Wave 2 (Persistent Alert Engine) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the analyst's stateless, deterministic, localStorage-dismissable alerts with a server-side persistent alert engine: an `analyst_alert` table with an active→acknowledged→resolved state machine, signature-based upsert + auto-resolve, two producers (ported deterministic rules + an LLM insight pass with citations), a scheduled Celery scan that writes notifications, and a frontend that acknowledges (never hides) alerts and surfaces citations.

**Architecture:** A new `app/analyst/insight/` package owns alert generation and lifecycle. Producers emit pure `AlertSpec` objects (each carrying a stable `signature` and a `producer` tag). A `sync_alerts` engine upserts specs into `analyst_alert` by signature — inserting new `active` rows, updating mutable fields on existing rows while preserving an `acknowledged` state, and `resolved`-ing any previously-active alert (of the producers in this run) whose signature was not re-emitted. `run_alert_scan` ties it together for one household; `GET /analyst/monitor` runs a cheap deterministic-only sync synchronously and returns the persisted rows, while a daily Celery task runs the full scan (deterministic + LLM insight) across all households and enqueues notifications.

**Tech Stack:** FastAPI, SQLAlchemy (async), Alembic, Celery + Redis beat, the M3 `LLMClient.chat()` gateway, the existing `app/notifications/service.enqueue_notification`, pytest + pytest-asyncio; web is Next.js + TanStack Query + Vitest.

## Global Constraints

- All new tables include `household_id` and are queried via `app.auth.deps.scoped_query` for tenant isolation. (verbatim: tenant isolation is mandatory)
- Enum-like columns use `str_enum("name", "a", "b")` (VARCHAR + CHECK), never native PG enums — per `app/models/base.py`.
- The analyst is **optional**: any LLM/embedding failure must degrade gracefully (skip the LLM producer, keep deterministic alerts), never raise a 5xx — match the `except LLMError` / bare `except Exception` handling in `app/analyst/service.py`.
- Money is `NUMERIC(18,2)`; currency is a 3-letter ISO string. Alert detail strings format money the same way the existing `derive_alerts` does.
- Tests connect to `TEST_DATABASE_URL` (default `postgresql+asyncpg://finance:finance@localhost:5433/finance`) and `pytest.skip` when Postgres is unreachable — copy the `engine`/`session`/`_user` fixtures from `tests/test_m22_memory.py`. DB-backed tests clean up by a `pytest-m22a-` household-name prefix.
- New migration's `down_revision` is the current head `d1a2b3c4e5f6` (the W1 m22 memory migration).
- Run backend tests in the api container (local `.venv` is x86_64/broken): `docker compose exec api pytest tests/test_m22_alerts.py -v`. If the image is stale, `docker compose build api` first.
- Web tests/typecheck run from `web/`: `npx vitest run <path>` and `npm run typecheck`.

---

### Task 1: `analyst_alert` model + migration

**Files:**
- Create: `backend/app/models/alerts.py`
- Modify: `backend/app/models/__init__.py`
- Create: `backend/migrations/versions/e2b3c4d5f6a7_m22_analyst_alert.py`
- Test: `backend/tests/test_m22_alerts.py`

**Interfaces:**
- Produces: `AnalystAlertRow(id, household_id, kind, producer, severity, tone, signature, state, title, detail, suggested_action, supporting_refs, acknowledged_at, resolved_at, created_at, updated_at)`.
- `AnalystAlertRow.state` ∈ {`active`,`acknowledged`,`resolved`}; `tone` ∈ {`positive`,`info`,`warning`,`danger`}; `producer` is a free string (`deterministic`,`insight`,`correlation`).
- The ORM class is named `AnalystAlertRow` (NOT `AnalystAlert`) to avoid colliding with the existing pydantic `app.analyst.schemas.AnalystAlert`.

- [ ] **Step 1: Write the model file**

```python
# backend/app/models/alerts.py
"""Persistent, stateful analyst alerts (W2). Replaces the frontend localStorage
dismissal: alerts live server-side, can be acknowledged (still visible) but never
user-hidden, and auto-resolve when their producing condition stops re-emitting
their signature. The ORM class is AnalystAlertRow to avoid clashing with the
pydantic app.analyst.schemas.AnalystAlert."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, fk_uuid, str_enum, uuid_pk


class AnalystAlertRow(Base):
    __tablename__ = "analyst_alert"

    id: Mapped[uuid.UUID] = uuid_pk()
    household_id: Mapped[uuid.UUID] = fk_uuid(
        ForeignKey("household.id", ondelete="CASCADE"), index=True, nullable=False
    )
    kind: Mapped[str] = mapped_column(String(64), nullable=False)
    producer: Mapped[str] = mapped_column(String(32), nullable=False, default="deterministic")
    severity: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    tone: Mapped[str] = mapped_column(
        str_enum("analyst_alert_tone", "positive", "info", "warning", "danger"),
        nullable=False, default="info",
    )
    signature: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    state: Mapped[str] = mapped_column(
        str_enum("analyst_alert_state", "active", "acknowledged", "resolved"),
        nullable=False, default="active",
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)
    detail: Mapped[str] = mapped_column(Text, nullable=False)
    suggested_action: Mapped[dict | None] = mapped_column(JSONB)
    supporting_refs: Mapped[list | None] = mapped_column(JSONB)
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
```

- [ ] **Step 2: Register the module so metadata sees the table**

In `backend/app/models/__init__.py`, add `from app.models import alerts  # noqa: F401` alongside the other model imports (match the existing import style — it already has `from app.models import memory  # noqa: F401` from W1).

- [ ] **Step 3: Write the Alembic migration**

```python
# backend/migrations/versions/e2b3c4d5f6a7_m22_analyst_alert.py
"""m22 analyst alert: persistent stateful alerts table

Revision ID: e2b3c4d5f6a7
Revises: d1a2b3c4e5f6
"""
from __future__ import annotations

from typing import Union

import sqlalchemy as sa
from alembic import op

revision: str = "e2b3c4d5f6a7"
down_revision: Union[str, None] = "d1a2b3c4e5f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "analyst_alert",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("household_id", sa.dialects.postgresql.UUID(as_uuid=True), sa.ForeignKey("household.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("kind", sa.String(length=64), nullable=False),
        sa.Column("producer", sa.String(length=32), nullable=False, server_default="deterministic"),
        sa.Column("severity", sa.Integer(), nullable=False, server_default="5"),
        sa.Column("tone", sa.String(), nullable=False, server_default="info"),
        sa.Column("signature", sa.String(length=255), nullable=False, index=True),
        sa.Column("state", sa.String(), nullable=False, server_default="active"),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("detail", sa.Text(), nullable=False),
        sa.Column("suggested_action", sa.dialects.postgresql.JSONB(), nullable=True),
        sa.Column("supporting_refs", sa.dialects.postgresql.JSONB(), nullable=True),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("tone IN ('positive','info','warning','danger')", name="ck_analyst_alert_tone"),
        sa.CheckConstraint("state IN ('active','acknowledged','resolved')", name="ck_analyst_alert_state"),
    )
    op.create_index("ix_analyst_alert_hh_sig", "analyst_alert", ["household_id", "signature"])


def downgrade() -> None:
    op.drop_index("ix_analyst_alert_hh_sig", table_name="analyst_alert")
    op.drop_table("analyst_alert")
```

- [ ] **Step 4: Apply the migration**

Run: `docker compose exec api alembic upgrade head`
Expected: `Running upgrade d1a2b3c4e5f6 -> e2b3c4d5f6a7, m22 analyst alert`

- [ ] **Step 5: Write the failing round-trip test**

```python
# backend/tests/test_m22_alerts.py
from __future__ import annotations

import os
import uuid
from datetime import date
from decimal import Decimal

import pytest
import pytest_asyncio
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models.alerts import AnalystAlertRow
from app.models.core import Household, User

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL", "postgresql+asyncpg://finance:finance@localhost:5433/finance")
PREFIX = "pytest-m22a-"


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
        await conn.execute(text("DELETE FROM household WHERE name LIKE :p"), {"p": f"{PREFIX}%"})
    await eng.dispose()


@pytest_asyncio.fixture
async def session(engine):
    async with async_sessionmaker(engine, expire_on_commit=False)() as s:
        yield s


async def _user(session):
    hh = Household(name=f"{PREFIX}{uuid.uuid4().hex[:8]}", base_currency="USD")
    session.add(hh)
    await session.flush()
    user = User(household_id=hh.id, email=f"{uuid.uuid4().hex}@example.com", password_hash="x", role="owner")
    session.add(user)
    await session.commit()
    return user


@pytest.mark.asyncio
async def test_analyst_alert_round_trip_defaults(session):
    user = await _user(session)
    row = AnalystAlertRow(household_id=user.household_id, kind="negative_cashflow",
                          severity=8, tone="warning", signature="negative_cashflow",
                          title="Cash flow is negative", detail="Spending exceeds income.")
    session.add(row)
    await session.commit()
    found = (await session.execute(select(AnalystAlertRow).where(
        AnalystAlertRow.household_id == user.household_id))).scalars().all()
    assert found[0].state == "active"
    assert found[0].producer == "deterministic"
    assert found[0].acknowledged_at is None
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `docker compose exec api pytest tests/test_m22_alerts.py::test_analyst_alert_round_trip_defaults -v`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add backend/app/models/alerts.py backend/app/models/__init__.py backend/migrations/versions/e2b3c4d5f6a7_m22_analyst_alert.py backend/tests/test_m22_alerts.py
git commit -m "feat(analyst): analyst_alert table + state machine columns"
```

---

### Task 2: `AlertSpec` + deterministic spec producer

**Files:**
- Create: `backend/app/analyst/insight/__init__.py` (empty)
- Create: `backend/app/analyst/insight/specs.py`
- Test: `backend/tests/test_m22_alerts.py` (append)

**Interfaces:**
- Consumes: `FinancialSnapshot` (`app/analyst/schemas.py`).
- Produces: `class AlertSpec(BaseModel)` with `kind: str`, `producer: str`, `severity: int`, `tone: str`, `signature: str`, `title: str`, `detail: str`, `suggested_action: dict | None = None`, `supporting_refs: list | None = None`; and `derive_alert_specs(snapshot: FinancialSnapshot) -> list[AlertSpec]` — a pure port of the deterministic rules in `service.derive_alerts`, producing stable signatures and NO "all clear" filler (an empty list means nothing is wrong).

- [ ] **Step 1: Write the failing test (append)**

```python
from app.analyst.insight.specs import AlertSpec, derive_alert_specs
from app.analyst.schemas import FinancialSnapshot


def _snap(**kw) -> FinancialSnapshot:
    base = dict(currency="USD", income=0.0, expenses=0.0, net=0.0, net_worth=0.0, assets=0.0, liabilities=0.0)
    base.update(kw)
    return FinancialSnapshot(**base)


def test_derive_alert_specs_budget_and_cashflow_signatures():
    specs = derive_alert_specs(_snap(
        net=-1200, income=3000, expenses=4200,
        budget_overages=[{"category_id": "c1", "name": "Dining", "over": 40, "pct": 120}],
    ))
    by_sig = {s.signature: s for s in specs}
    assert "negative_cashflow" in by_sig
    assert "budget_overspend:c1" in by_sig
    assert by_sig["budget_overspend:c1"].tone == "danger"
    assert by_sig["budget_overspend:c1"].producer == "deterministic"


def test_derive_alert_specs_clean_snapshot_is_empty():
    assert derive_alert_specs(_snap()) == []
```

- [ ] **Step 2: Run to verify failure**

Run: `docker compose exec api pytest tests/test_m22_alerts.py -k derive_alert_specs -v`
Expected: FAIL with `ModuleNotFoundError: app.analyst.insight.specs`

- [ ] **Step 3: Implement the spec producer**

```python
# backend/app/analyst/insight/specs.py
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
```

- [ ] **Step 4: Run to verify pass**

Run: `docker compose exec api pytest tests/test_m22_alerts.py -k derive_alert_specs -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/analyst/insight/__init__.py backend/app/analyst/insight/specs.py backend/tests/test_m22_alerts.py
git commit -m "feat(analyst): deterministic alert spec producer with stable signatures"
```

---

### Task 3: Sync engine — upsert by signature + auto-resolve + acknowledge

**Files:**
- Create: `backend/app/analyst/insight/engine.py`
- Test: `backend/tests/test_m22_alerts.py` (append)

**Interfaces:**
- Consumes: `AlertSpec` (Task 2); `AnalystAlertRow` (Task 1); `scoped_query`.
- Produces:
  - `async sync_alerts(session, household_id, specs, *, producers) -> dict` returning `{"created": list[AnalystAlertRow], "resolved": int, "updated": int}`. Inserts a new `active` row per unseen signature; on an existing non-resolved row it refreshes mutable fields (kind/severity/tone/title/detail/suggested_action/supporting_refs) but PRESERVES `state` (an `acknowledged` row stays acknowledged); any non-resolved row whose `producer ∈ producers` and whose signature is NOT in this run is set to `resolved` with `resolved_at`.
  - `async list_alerts(session, user) -> list[AnalystAlertRow]` — household-scoped rows where `state != 'resolved'`, ordered active-before-acknowledged then severity desc.
  - `async acknowledge_alert(session, user, alert_id) -> AnalystAlertRow | None` — sets `state='acknowledged'`, `acknowledged_at=now`; returns None if not found in the user's household.

- [ ] **Step 1: Write the failing test (append)**

```python
from app.analyst.insight.engine import acknowledge_alert, list_alerts, sync_alerts


def _spec(sig, **kw):
    base = dict(kind="negative_cashflow", producer="deterministic", severity=8, tone="warning",
                signature=sig, title="t", detail="d")
    base.update(kw)
    return AlertSpec(**base)


@pytest.mark.asyncio
async def test_sync_inserts_then_resolves_when_signature_drops(session):
    user = await _user(session)
    r1 = await sync_alerts(session, user.household_id, [_spec("negative_cashflow")], producers={"deterministic"})
    assert len(r1["created"]) == 1 and r1["resolved"] == 0
    # Second run with the condition gone -> the prior alert auto-resolves.
    r2 = await sync_alerts(session, user.household_id, [], producers={"deterministic"})
    assert r2["resolved"] == 1
    open_rows = await list_alerts(session, user)
    assert open_rows == []


@pytest.mark.asyncio
async def test_acknowledge_persists_and_survives_resync(session):
    user = await _user(session)
    await sync_alerts(session, user.household_id, [_spec("negative_cashflow")], producers={"deterministic"})
    row = (await list_alerts(session, user))[0]
    acked = await acknowledge_alert(session, user, row.id)
    assert acked.state == "acknowledged" and acked.acknowledged_at is not None
    # Re-emitting the same signature must NOT flip it back to active.
    await sync_alerts(session, user.household_id, [_spec("negative_cashflow", detail="d2")], producers={"deterministic"})
    again = (await list_alerts(session, user))[0]
    assert again.state == "acknowledged" and again.detail == "d2"


@pytest.mark.asyncio
async def test_sync_does_not_resolve_other_producers(session):
    user = await _user(session)
    await sync_alerts(session, user.household_id, [_spec("insight:x", producer="insight")], producers={"insight"})
    # A deterministic-only run must leave the insight alert untouched.
    await sync_alerts(session, user.household_id, [], producers={"deterministic"})
    sigs = {r.signature for r in await list_alerts(session, user)}
    assert "insight:x" in sigs
```

- [ ] **Step 2: Run to verify failure**

Run: `docker compose exec api pytest tests/test_m22_alerts.py -k "sync or acknowledge" -v`
Expected: FAIL with `ModuleNotFoundError: app.analyst.insight.engine`

- [ ] **Step 3: Implement the engine**

```python
# backend/app/analyst/insight/engine.py
"""Alert lifecycle: upsert AlertSpecs into analyst_alert by signature, preserve
acknowledged state across re-emits, and auto-resolve alerts (scoped to the
producers in the current run) whose signature stopped firing."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.analyst.insight.specs import AlertSpec
from app.auth.deps import scoped_query
from app.models.alerts import AnalystAlertRow
from app.models.core import User


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def sync_alerts(
    session: AsyncSession, household_id: uuid.UUID, specs: list[AlertSpec], *, producers: set[str],
) -> dict:
    existing = list((await session.execute(
        select(AnalystAlertRow).where(
            AnalystAlertRow.household_id == household_id,
            AnalystAlertRow.state != "resolved",
        )
    )).scalars().all())
    by_sig = {row.signature: row for row in existing}
    seen: set[str] = set()
    created: list[AnalystAlertRow] = []
    updated = 0
    for spec in specs:
        seen.add(spec.signature)
        row = by_sig.get(spec.signature)
        if row is None:
            row = AnalystAlertRow(
                household_id=household_id, kind=spec.kind, producer=spec.producer,
                severity=spec.severity, tone=spec.tone, signature=spec.signature,
                state="active", title=spec.title, detail=spec.detail,
                suggested_action=spec.suggested_action, supporting_refs=spec.supporting_refs,
            )
            session.add(row)
            created.append(row)
        else:
            row.kind = spec.kind
            row.severity = spec.severity
            row.tone = spec.tone
            row.title = spec.title
            row.detail = spec.detail
            row.suggested_action = spec.suggested_action
            row.supporting_refs = spec.supporting_refs
            updated += 1  # state intentionally preserved
    resolved = 0
    now = _now()
    for sig, row in by_sig.items():
        if sig not in seen and row.producer in producers and row.state in ("active", "acknowledged"):
            row.state = "resolved"
            row.resolved_at = now
            resolved += 1
    await session.commit()
    return {"created": created, "resolved": resolved, "updated": updated}


async def list_alerts(session: AsyncSession, user: User) -> list[AnalystAlertRow]:
    stmt = (
        scoped_query(AnalystAlertRow, user)
        .where(AnalystAlertRow.state != "resolved")
        # active (0) before acknowledged (1), then most severe first.
        .order_by(
            (AnalystAlertRow.state == "acknowledged"),
            AnalystAlertRow.severity.desc(),
            AnalystAlertRow.created_at.desc(),
        )
    )
    return list((await session.execute(stmt)).scalars().all())


async def acknowledge_alert(session: AsyncSession, user: User, alert_id: uuid.UUID) -> AnalystAlertRow | None:
    row = (await session.execute(
        scoped_query(AnalystAlertRow, user).where(AnalystAlertRow.id == alert_id)
    )).scalar_one_or_none()
    if row is None:
        return None
    row.state = "acknowledged"
    row.acknowledged_at = _now()
    await session.commit()
    return row
```

- [ ] **Step 4: Run to verify pass**

Run: `docker compose exec api pytest tests/test_m22_alerts.py -k "sync or acknowledge" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/analyst/insight/engine.py backend/tests/test_m22_alerts.py
git commit -m "feat(analyst): alert sync engine with acknowledge + producer-scoped auto-resolve"
```

---

### Task 4: LLM insight producer (with citations)

**Files:**
- Create: `backend/app/analyst/insight/llm.py`
- Test: `backend/tests/test_m22_alerts.py` (append)

**Interfaces:**
- Consumes: `AlertSpec` (Task 2); `FinancialSnapshot`; `AssembledContext` (`app/analyst/memory/assembler.py`); `llm.chat(..., json_schema=...)` (M3).
- Produces: `async llm_insight_specs(session, user, snapshot, llm, ctx=None) -> list[AlertSpec]`. Returns `[]` when `llm` is None or on any LLM error. Each spec has `producer="insight"`, `kind="insight"`, signature `insight:<sha1(title.lower())[:12]>`, tone clamped to the allowed set (default `info`), severity clamped to 1–9, and `supporting_refs` = the chunk refs from `ctx` (best-effort provenance) when present.

- [ ] **Step 1: Write the failing test (append)**

```python
from app.analyst.insight.llm import llm_insight_specs


class _InsightLLM:
    async def chat(self, messages, **kw):
        return {"insights": [
            {"title": "Dining spend is climbing", "detail": "Up 38% vs last period.", "tone": "warning", "severity": 7},
            {"title": "Subscriptions look high", "detail": "12% of expenses.", "tone": "bogus", "severity": 99},
        ]}


@pytest.mark.asyncio
async def test_llm_insight_specs_clamps_and_signs(session):
    user = await _user(session)
    specs = await llm_insight_specs(session, user, _snap(expenses=1000), _InsightLLM())
    assert len(specs) == 2
    assert all(s.producer == "insight" and s.kind == "insight" for s in specs)
    assert all(s.signature.startswith("insight:") for s in specs)
    assert specs[0].tone == "warning" and specs[0].severity == 7
    assert specs[1].tone == "info" and 1 <= specs[1].severity <= 9  # bad values clamped


@pytest.mark.asyncio
async def test_llm_insight_specs_none_llm_is_empty(session):
    user = await _user(session)
    assert await llm_insight_specs(session, user, _snap(), None) == []
```

- [ ] **Step 2: Run to verify failure**

Run: `docker compose exec api pytest tests/test_m22_alerts.py -k llm_insight -v`
Expected: FAIL with `ModuleNotFoundError: app.analyst.insight.llm`

- [ ] **Step 3: Implement the LLM insight producer**

```python
# backend/app/analyst/insight/llm.py
"""LLM insight producer: reads the assembled context (snapshot + facts + notable
chunks) and surfaces non-obvious findings as AlertSpecs. Best-effort — any
provider failure yields an empty list so deterministic alerts still flow."""

from __future__ import annotations

import hashlib
import json

from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.analyst.insight.specs import AlertSpec
from app.analyst.schemas import FinancialSnapshot
from app.models.core import User

_TONES = {"positive", "info", "warning", "danger"}

_SYSTEM = (
    "You are a personal-finance analyst scanning a user's data for non-obvious, "
    "actionable findings (rising categories, unusual recurring costs, savings "
    "opportunities). Use ONLY the provided snapshot, facts, and records. Never "
    "invent numbers. Return at most 3 concise insights; return an empty list if "
    "nothing is noteworthy. Use plain text without Markdown."
)


class _Insight(BaseModel):
    title: str
    detail: str
    tone: str = "info"
    severity: int = 5


class _InsightList(BaseModel):
    insights: list[_Insight] = []


def _clamp_severity(value: int) -> int:
    try:
        return max(1, min(9, int(value)))
    except (TypeError, ValueError):
        return 5


async def llm_insight_specs(
    session: AsyncSession, user: User, snapshot: FinancialSnapshot, llm, ctx=None,
) -> list[AlertSpec]:
    if llm is None:
        return []
    refs = None
    body = f"Financial snapshot (JSON):\n{snapshot.model_dump_json()}"
    if ctx is not None:
        if getattr(ctx, "facts", None):
            body += "\n\nKnown facts:\n" + "\n".join(f"- ({f['domain']}) {f['text']}" for f in ctx.facts)
        if getattr(ctx, "chunks", None):
            body += "\n\nRelevant records:\n" + "\n".join(f"- {c['text']}" for c in ctx.chunks)
            refs = [{"source_type": c["source_type"], "source_id": c["source_id"]} for c in ctx.chunks]
    messages = [{"role": "system", "content": _SYSTEM}, {"role": "user", "content": body}]
    try:
        result = await llm.chat(messages, json_schema=_InsightList, purpose="analyst.insight",
                                user_id=user.id, session=session)
        parsed = _InsightList(**result)
    except Exception:  # insight is best-effort; never break the scan
        return []
    specs: list[AlertSpec] = []
    for ins in parsed.insights:
        sig = "insight:" + hashlib.sha1(ins.title.strip().lower().encode("utf-8")).hexdigest()[:12]
        specs.append(AlertSpec(
            kind="insight", producer="insight", severity=_clamp_severity(ins.severity),
            tone=ins.tone if ins.tone in _TONES else "info",
            signature=sig, title=ins.title.strip(), detail=ins.detail.strip(),
            supporting_refs=refs,
        ))
    return specs
```

- [ ] **Step 4: Run to verify pass**

Run: `docker compose exec api pytest tests/test_m22_alerts.py -k llm_insight -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/analyst/insight/llm.py backend/tests/test_m22_alerts.py
git commit -m "feat(analyst): LLM insight alert producer with context citations"
```

---

### Task 5: `run_alert_scan` orchestrator + notifications + scan-all

**Files:**
- Create: `backend/app/analyst/insight/scan.py`
- Test: `backend/tests/test_m22_alerts.py` (append)

**Interfaces:**
- Consumes: `derive_alert_specs` (Task 2); `sync_alerts` (Task 3); `llm_insight_specs` (Task 4); `build_snapshot` (`app/analyst/snapshot.py`); `assemble` (`app/analyst/memory/assembler.py`); `enqueue_notification` (`app/notifications/service.py`).
- Produces:
  - `async run_alert_scan(session, user, llm=None, *, from_date=None, to_date=None, llm_insights=True, notify=False) -> dict` returning `{"created": int, "resolved": int, "active": int}`. Builds one snapshot (defaults: last 90 days through today), gathers deterministic specs always and insight specs when `llm` is present and `llm_insights`, syncs with `producers` covering exactly the producers that ran, and — when `notify=True` — enqueues one `analyst_alert` inapp/push notification per newly-created row (idempotent by signature).
  - `async scan_all_households(session, get_llm) -> dict` where `get_llm(household_id) -> llm | None` (async): iterates every household, picks its earliest active user, and runs a full notifying scan; aggregates counts. Robust to per-household failures.

- [ ] **Step 1: Write the failing test (append)**

```python
from app.analyst.insight import scan as scan_mod
from app.models.guidance import Notification
from app.models.transactions import Budget, Category


@pytest.mark.asyncio
async def test_run_alert_scan_persists_and_notifies(session, monkeypatch):
    user = await _user(session)

    async def fake_snapshot(*a, **k):
        return _snap(net=-500, income=1000, expenses=1500)

    monkeypatch.setattr(scan_mod, "build_snapshot", fake_snapshot)
    out = await scan_mod.run_alert_scan(session, user, llm=None, llm_insights=False, notify=True)
    assert out["created"] == 1 and out["active"] == 1
    notes = (await session.execute(select(Notification).where(
        Notification.household_id == user.household_id,
        Notification.type == "analyst_alert"))).scalars().all()
    assert len(notes) >= 1
    # Re-running with the same condition must NOT create a duplicate notification.
    out2 = await scan_mod.run_alert_scan(session, user, llm=None, llm_insights=False, notify=True)
    assert out2["created"] == 0
```

- [ ] **Step 2: Run to verify failure**

Run: `docker compose exec api pytest tests/test_m22_alerts.py -k run_alert_scan -v`
Expected: FAIL with `ModuleNotFoundError: app.analyst.insight.scan`

- [ ] **Step 3: Implement the orchestrator**

```python
# backend/app/analyst/insight/scan.py
"""Per-household alert scan: build the snapshot, run the deterministic and
(optional) LLM insight producers, sync them into analyst_alert, and optionally
enqueue notifications for freshly-created alerts. scan_all_households is the
entry point for the scheduled Celery job."""

from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.analyst.insight.engine import sync_alerts
from app.analyst.insight.llm import llm_insight_specs
from app.analyst.insight.specs import derive_alert_specs
from app.analyst.memory.assembler import assemble
from app.analyst.snapshot import build_snapshot
from app.models.core import Household, User
from app.notifications import service as notifications


async def run_alert_scan(
    session: AsyncSession, user: User, llm=None, *,
    from_date: date | None = None, to_date: date | None = None,
    llm_insights: bool = True, notify: bool = False,
) -> dict:
    to_date = to_date or date.today()
    from_date = from_date or (to_date - timedelta(days=90))
    snapshot = await build_snapshot(session, user, from_date, to_date)
    specs = list(derive_alert_specs(snapshot))
    producers = {"deterministic"}
    if llm is not None and llm_insights:
        try:
            ctx = await assemble(session, user, "Surface notable financial issues", llm, from_date, to_date)
        except Exception:
            ctx = None
        specs += await llm_insight_specs(session, user, snapshot, llm, ctx)
        producers.add("insight")
    result = await sync_alerts(session, user.household_id, specs, producers=producers)
    if notify and result["created"]:
        for row in result["created"]:
            await notifications.enqueue_notification(
                session, household_id=user.household_id, user_id=user.id,
                type="analyst_alert",
                payload={"alert_id": str(row.id), "kind": row.kind, "title": row.title, "detail": row.detail},
                idempotency_key=f"analyst_alert:{row.signature}",
            )
        await session.commit()
    active = sum(1 for s in specs)  # specs reflect the conditions currently firing
    return {"created": len(result["created"]), "resolved": result["resolved"], "active": active}


async def scan_all_households(session: AsyncSession, get_llm) -> dict:
    households = list((await session.execute(select(Household))).scalars().all())
    totals = {"households": 0, "created": 0, "resolved": 0}
    for hh in households:
        user = (await session.execute(
            select(User).where(User.household_id == hh.id, User.is_active.is_(True))
            .order_by(User.created_at.asc()).limit(1)
        )).scalar_one_or_none()
        if user is None:
            continue
        try:
            llm = await get_llm(hh.id)
        except Exception:
            llm = None
        try:
            out = await run_alert_scan(session, user, llm, llm_insights=llm is not None, notify=True)
        except Exception:
            continue  # one bad household must not abort the rest
        totals["households"] += 1
        totals["created"] += out["created"]
        totals["resolved"] += out["resolved"]
    return totals
```

- [ ] **Step 4: Run to verify pass**

Run: `docker compose exec api pytest tests/test_m22_alerts.py -k run_alert_scan -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/analyst/insight/scan.py backend/tests/test_m22_alerts.py
git commit -m "feat(analyst): per-household alert scan + scheduled scan-all orchestrator"
```

---

### Task 6: Celery task + beat schedule

**Files:**
- Create: `backend/app/tasks/analyst.py`
- Modify: `backend/app/celery_app.py`
- Test: `backend/tests/test_m22_alerts.py` (append)

**Interfaces:**
- Consumes: `scan_all_households` (Task 5); `get_household_llm_client` (`app/llm/client.py`, used the same way as `app/tasks/ocr.py`); `SessionLocal` (`app/db.py`).
- Produces: Celery task `analyst.scan_alerts` (sync entrypoint wrapping the async scan with `asyncio.run`), registered in `celery_app` imports + a daily beat entry.

- [ ] **Step 1: Write the task module**

```python
# backend/app/tasks/analyst.py
"""Scheduled analyst alert scan (W2). Runs the full deterministic + LLM insight
producers across every household and writes persistent alerts + notifications."""

from __future__ import annotations

import asyncio

from app.analyst.insight.scan import scan_all_households
from app.celery_app import celery
from app.db import SessionLocal
from app.llm.client import get_household_llm_client


@celery.task(name="analyst.scan_alerts")
def scan_alerts() -> dict:
    return asyncio.run(_scan_alerts())


async def _scan_alerts() -> dict:
    async with SessionLocal() as session:
        async def get_llm(household_id):
            return await get_household_llm_client(session, household_id)
        return await scan_all_households(session, get_llm)
```

- [ ] **Step 2: Register the task + beat schedule**

In `backend/app/celery_app.py`, add `"app.tasks.analyst"` to the `imports=(...)` tuple, and add to `beat_schedule`:

```python
        "analyst-scan-alerts-daily": {
            "task": "analyst.scan_alerts",
            "schedule": crontab(hour=4, minute=0),
        },
```

- [ ] **Step 3: Write the registration test (append)**

```python
def test_analyst_scan_task_registered():
    import app.tasks.analyst  # noqa: F401  (force task registration)
    from app.celery_app import celery
    assert "analyst.scan_alerts" in celery.tasks
    assert "analyst-scan-alerts-daily" in celery.conf.beat_schedule
```

- [ ] **Step 4: Run to verify pass**

Run: `docker compose exec api pytest tests/test_m22_alerts.py -k analyst_scan_task -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/tasks/analyst.py backend/app/celery_app.py backend/tests/test_m22_alerts.py
git commit -m "feat(analyst): scheduled Celery alert scan (daily) across households"
```

---

### Task 7: API — persisted monitor, list/acknowledge endpoints, manual scan

**Files:**
- Modify: `backend/app/analyst/schemas.py` (add `PersistentAlert`; switch `MonitorOut`)
- Modify: `backend/app/analyst/service.py` (`run_monitor` reads persisted; add `run_acknowledge`, `run_scan_alerts`)
- Modify: `backend/app/analyst/router.py` (acknowledge + manual scan endpoints)
- Test: `backend/tests/test_m22_alerts.py` + `backend/tests/test_m19_analyst.py` (append)

**Interfaces:**
- Consumes: `run_alert_scan`, `list_alerts`, `acknowledge_alert` (Tasks 3/5).
- Produces:
  - `class PersistentAlert(BaseModel)`: `id: str`, `kind: str`, `severity: int`, `tone: Tone`, `state: Literal["active","acknowledged","resolved"]`, `title: str`, `detail: str`, `suggested_action: AnalystAction | None = None`, `supporting_refs: list[dict] = []`, `acknowledged_at: datetime | None = None`, `resolved_at: datetime | None = None`.
  - `MonitorOut.alerts: list[PersistentAlert]` (was `list[AnalystAlert]`).
  - `run_monitor` now runs a synchronous deterministic-only scan (no LLM, no notify) then returns persisted non-resolved rows.
  - `async run_acknowledge(session, user, alert_id) -> PersistentAlert | None`; `async run_scan_alerts(session, user, llm) -> dict`.
  - `POST /analyst/alerts/{alert_id}/acknowledge` → `PersistentAlert` (404 if missing); `POST /analyst/scan` → scan counts.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_m22_alerts.py`:

```python
@pytest.mark.asyncio
async def test_run_monitor_returns_persisted_alerts(session, monkeypatch):
    from app.analyst import service
    user = await _user(session)

    async def fake_snapshot(*a, **k):
        return _snap(net=-200, income=500, expenses=700)

    monkeypatch.setattr("app.analyst.insight.scan.build_snapshot", fake_snapshot)
    out = await service.run_monitor(session, user, date(2026, 6, 1), date(2026, 6, 30))
    assert any(a.kind == "negative_cashflow" and a.state == "active" for a in out.alerts)


@pytest.mark.asyncio
async def test_run_acknowledge_flips_state(session, monkeypatch):
    from app.analyst import service
    user = await _user(session)

    async def fake_snapshot(*a, **k):
        return _snap(net=-200, income=500, expenses=700)

    monkeypatch.setattr("app.analyst.insight.scan.build_snapshot", fake_snapshot)
    mon = await service.run_monitor(session, user, date(2026, 6, 1), date(2026, 6, 30))
    aid = mon.alerts[0].id
    acked = await service.run_acknowledge(session, user, uuid.UUID(aid))
    assert acked.state == "acknowledged"
```

Append to `backend/tests/test_m19_analyst.py`:

```python
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
```

- [ ] **Step 2: Run to verify failure**

Run: `docker compose exec api pytest tests/test_m19_analyst.py -k "persistent_alert_schema or acknowledge_route" tests/test_m22_alerts.py -k "run_monitor or run_acknowledge" -v`
Expected: FAIL (`PersistentAlert` undefined / routes missing)

- [ ] **Step 3: Add the `PersistentAlert` schema and switch `MonitorOut`**

In `backend/app/analyst/schemas.py`, add `datetime` is already imported. Add after `class AnalystAlert` (keep `AnalystAlert` — it is still used by `derive_alerts` and `test_m19`):

```python
class PersistentAlert(BaseModel):
    id: str
    kind: str
    severity: int = Field(ge=0, le=10)
    tone: Tone
    state: Literal["active", "acknowledged", "resolved"]
    title: str
    detail: str
    suggested_action: AnalystAction | None = None
    supporting_refs: list[dict] = []
    acknowledged_at: datetime | None = None
    resolved_at: datetime | None = None
```

Change `MonitorOut`:

```python
class MonitorOut(BaseModel):
    alerts: list[PersistentAlert]
```

- [ ] **Step 4: Rewrite `run_monitor` and add service helpers**

In `backend/app/analyst/service.py`, add imports near the top (with the other `app.analyst.insight` imports kept local to avoid import cycles — import inside the functions):

Replace the existing `run_monitor` body:

```python
async def run_monitor(
    session: AsyncSession, user: User, from_date: date, to_date: date
) -> MonitorOut:
    from app.analyst.insight.engine import list_alerts
    from app.analyst.insight.scan import run_alert_scan
    try:
        # Cheap deterministic-only refresh keeps the feed correct even if the
        # scheduled job has not run; LLM insights come from the background scan.
        await run_alert_scan(session, user, llm=None, from_date=from_date, to_date=to_date,
                             llm_insights=False, notify=False)
    except Exception:  # the optional analyst must never 5xx the monitor feed
        pass
    rows = await list_alerts(session, user)
    return MonitorOut(alerts=[_to_persistent(row) for row in rows])


def _to_persistent(row) -> PersistentAlert:
    action = AnalystAction(**row.suggested_action) if row.suggested_action else None
    return PersistentAlert(
        id=str(row.id), kind=row.kind, severity=row.severity, tone=row.tone,
        state=row.state, title=row.title, detail=row.detail, suggested_action=action,
        supporting_refs=row.supporting_refs or [],
        acknowledged_at=row.acknowledged_at, resolved_at=row.resolved_at,
    )


async def run_acknowledge(session, user, alert_id):
    from app.analyst.insight.engine import acknowledge_alert
    row = await acknowledge_alert(session, user, alert_id)
    return _to_persistent(row) if row is not None else None


async def run_scan_alerts(session, user, llm) -> dict:
    from app.analyst.insight.scan import run_alert_scan
    return await run_alert_scan(session, user, llm, llm_insights=True, notify=True)
```

Add `PersistentAlert` and `AnalystAction` to the existing `from app.analyst.schemas import (...)` block in `service.py` (`AnalystAction` is already imported; add `PersistentAlert`).

- [ ] **Step 5: Add the endpoints**

In `backend/app/analyst/router.py`, add `import uuid` at top and `from fastapi import HTTPException`, then:

```python
@router.post("/alerts/{alert_id}/acknowledge", response_model=PersistentAlert)
async def acknowledge(
    alert_id: uuid.UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    result = await service.run_acknowledge(session, user, alert_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Alert not found")
    return result


@router.post("/scan")
async def scan(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    llm: LLMClient = Depends(get_llm_client),
):
    return await service.run_scan_alerts(session, user, llm)
```

Add `PersistentAlert` to the `from app.analyst.schemas import (...)` import line in `router.py`.

- [ ] **Step 6: Run the analyst suites**

Run: `docker compose exec api pytest tests/test_m19_analyst.py tests/test_m22_alerts.py -v`
Expected: PASS (all existing + new)

- [ ] **Step 7: Regenerate the OpenAPI schema for the frontend types**

The web client reads `@shared/api-schema`. Regenerate it so `PersistentAlert` and the new routes are typed. Run the repo's existing schema-export command:

Run: `docker compose exec api python -m app.openapi_export` if present; otherwise `cd web && npm run gen:api` (use whichever script exists — check `web/package.json` scripts and the repo's prior pattern; the generated file is the one imported as `@shared/api-schema`).
Expected: the generated schema file now contains `PersistentAlert` and `/analyst/alerts/{alert_id}/acknowledge`.

- [ ] **Step 8: Commit**

```bash
git add backend/app/analyst/schemas.py backend/app/analyst/service.py backend/app/analyst/router.py backend/tests/test_m19_analyst.py backend/tests/test_m22_alerts.py
git add -A  # include the regenerated api-schema
git commit -m "feat(analyst): persisted monitor + acknowledge/scan endpoints replacing dismissal"
```

---

### Task 8: Frontend — acknowledge action, muted acknowledged state, citations

**Files:**
- Modify: `web/lib/api/analyst.ts`
- Modify: `web/components/dashboard/analyst/monitor-feed.tsx`
- Test: `web/components/dashboard/analyst/monitor-feed.test.tsx`

**Interfaces:**
- Consumes: backend `MonitorOut.alerts: PersistentAlert[]` and `POST /analyst/alerts/{id}/acknowledge` (Task 7).
- Produces: `PersistentAlert` type; `useAcknowledgeAlert()` mutation (invalidates the monitor query); `AlertList` renders an **Acknowledge** action on `active` alerts, shows `acknowledged` alerts muted with no acknowledge button, and renders a "Sources" line when `supporting_refs` is non-empty.

- [ ] **Step 1: Write the failing test (replace `monitor-feed.test.tsx`)**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PersistentAlert } from "@/lib/api/analyst";
import { AlertList } from "./monitor-feed";

const alerts: PersistentAlert[] = [
  { id: "a1", kind: "budget_overspend", severity: 9, tone: "danger", state: "active",
    title: "Dining over", detail: "Over by $40",
    suggested_action: { type: "set_budget", label: "Adjust", params: {} },
    supporting_refs: [{ source_type: "transaction", source_id: "t1" }] },
  { id: "a2", kind: "insight", severity: 5, tone: "info", state: "acknowledged",
    title: "Subscriptions high", detail: "12% of spend", supporting_refs: [] },
];

describe("AlertList", () => {
  it("acknowledges active alerts and mutes acknowledged ones with sources", () => {
    const onAction = vi.fn();
    const onAcknowledge = vi.fn();
    render(<AlertList alerts={alerts} onAction={onAction} onAcknowledge={onAcknowledge} />);
    // active alert has an Acknowledge button + a Sources line
    screen.getByRole("button", { name: /Acknowledge/i }).click();
    expect(onAcknowledge).toHaveBeenCalledWith("a1");
    expect(screen.getByText(/Sources/i)).toBeInTheDocument();
    // acknowledged alert is still visible but offers no acknowledge button
    expect(screen.getByText("Subscriptions high")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd web && npx vitest run components/dashboard/analyst/monitor-feed.test.tsx`
Expected: FAIL (`onAcknowledge` prop / Acknowledge button absent)

- [ ] **Step 3: Add the type + acknowledge hook**

In `web/lib/api/analyst.ts`:
- Add `export type PersistentAlert = components["schemas"]["PersistentAlert"];`
- Change `export type Monitor = components["schemas"]["MonitorOut"];` stays (its `alerts` are now `PersistentAlert[]`).
- Keep `export type AnalystAlert = components["schemas"]["AnalystAlert"];` (still referenced elsewhere; harmless).
- Add the mutation:

```ts
export function useAcknowledgeAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.POST("/analyst/alerts/{alert_id}/acknowledge", { params: { path: { alert_id: id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["analyst", "monitor"] }),
  });
}
```

- [ ] **Step 4: Rewrite `monitor-feed.tsx`**

```tsx
"use client";

import { Check } from "lucide-react";
import { Private } from "@/components/dashboard/privacy-provider";
import type { DateRange } from "@/lib/dates";
import { useMonitor, useAcknowledgeAlert, type AnalystAction, type PersistentAlert } from "@/lib/api/analyst";
import { useAnalyst } from "./use-analyst";

const TONE: Record<PersistentAlert["tone"], string> = {
  danger: "border-red-500/40 bg-red-500/10",
  warning: "border-amber-500/40 bg-amber-500/10",
  info: "border-border bg-card/40",
  positive: "border-emerald-500/40 bg-emerald-500/10",
};

export function AlertList({
  alerts,
  onAction,
  onAcknowledge,
}: {
  alerts: PersistentAlert[];
  onAction: (action: AnalystAction) => void;
  onAcknowledge: (id: string) => void;
}) {
  if (!alerts.length) {
    return <p className="p-4 text-[13px] text-muted">All clear — nothing needs your attention.</p>;
  }
  return (
    <ul className="space-y-2 p-3">
      {alerts.map((alert) => {
        const acknowledged = alert.state === "acknowledged";
        const sources = Array.from(new Set((alert.supporting_refs ?? []).map((r) => r.source_type)));
        return (
          <li key={alert.id} className={`rounded-xl border p-3 ${TONE[alert.tone]} ${acknowledged ? "opacity-60" : ""}`}>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-fg">{alert.title}</p>
                <p className="mt-0.5 text-[12px] text-muted">
                  <Private kind="money">{alert.detail}</Private>
                </p>
                {sources.length > 0 && (
                  <p className="mt-1 text-[11px] text-muted">Sources: {sources.join(", ")}</p>
                )}
                <div className="mt-2 flex items-center gap-2">
                  {alert.suggested_action && (
                    <button
                      type="button"
                      onClick={() => onAction(alert.suggested_action!)}
                      className="rounded-lg bg-accent px-2.5 py-1.5 text-[11px] font-semibold text-on-accent"
                    >
                      {alert.suggested_action.label}
                    </button>
                  )}
                  {acknowledged ? (
                    <span className="inline-flex items-center gap-1 text-[11px] text-muted">
                      <Check className="size-3" /> Acknowledged
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onAcknowledge(alert.id)}
                      className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] text-muted hover:text-fg"
                    >
                      Acknowledge
                    </button>
                  )}
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function MonitorFeed({ range }: { range: DateRange }) {
  const { runAction } = useAnalyst();
  const query = useMonitor(range);
  const acknowledge = useAcknowledgeAlert();
  if (query.isLoading) {
    return <div className="space-y-2 p-3">{[0, 1, 2].map((item) => <div key={item} className="h-16 animate-pulse rounded-xl bg-chip" />)}</div>;
  }
  if (query.isError) {
    return <div className="p-4 text-[13px] text-muted">Couldn’t load alerts. <button type="button" className="font-semibold text-accent" onClick={() => query.refetch()}>Retry</button></div>;
  }
  return <AlertList alerts={query.data?.alerts ?? []} onAction={runAction} onAcknowledge={(id) => acknowledge.mutate(id)} />;
}
```

- [ ] **Step 5: Run to verify pass**

Run: `cd web && npx vitest run components/dashboard/analyst/monitor-feed.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add web/lib/api/analyst.ts web/components/dashboard/analyst/monitor-feed.tsx web/components/dashboard/analyst/monitor-feed.test.tsx
git commit -m "feat(analyst): acknowledge alerts + citations in monitor feed"
```

---

### Task 9: Frontend — remove localStorage dismissal from context + widget

**Files:**
- Modify: `web/components/dashboard/analyst/use-analyst.tsx`
- Modify: `web/components/dashboard/analyst/use-analyst.test.tsx`
- Modify: `web/components/dashboard/analyst/analyst-pane.test.tsx`
- Modify: `web/components/dashboard/widgets/ai-alert-widget.tsx`

**Interfaces:**
- Consumes: `useAcknowledgeAlert` + `PersistentAlert` (Task 8).
- Produces: `AnalystContextValue` no longer exposes `dismissed`/`dismiss`/`undismiss`; the AI alert widget acknowledges instead of dismissing and no longer filters by a local dismissed set (the server already omits resolved alerts).

- [ ] **Step 1: Strip dismissal from the context**

In `web/components/dashboard/analyst/use-analyst.tsx`:
- Delete `const STORAGE_KEY = "cf-analyst-dismissed";`.
- Remove `dismissed`, `dismiss`, `undismiss` from the `AnalystContextValue` type.
- Remove the `const [dismissed, setDismissed] = useState...` line, the `useEffect` that reads `localStorage`, and the `persist` callback.
- Remove `dismissed`, `dismiss`, `undismiss` from the `value` object and from the `useMemo` dependency array (so the deps become `[mode, open, range, focus, page]`).

- [ ] **Step 2: Update the context unit test**

In `web/components/dashboard/analyst/use-analyst.test.tsx`, remove the `dismissed`/`dismiss` span and button and the dismissal assertions. The probe component becomes:

```tsx
return <><span data-testid="open">{String(analyst.open)}</span><span data-testid="mode">{analyst.mode}</span><button onClick={analyst.toggle}>toggle</button><button onClick={() => analyst.setMode("plan")}>plan</button></>;
```

And the test body drops the dismiss `fireEvent.click` and the `dismissed` `expect`. Rename the `it("tracks open state, mode, and dismissals")` to `it("tracks open state and mode")`.

- [ ] **Step 3: Update the analyst-pane test mock**

In `web/components/dashboard/analyst/analyst-pane.test.tsx`, remove `dismissed: new Set(), dismiss: vi.fn(),` from the `useAnalyst` mock object (line 5).

- [ ] **Step 4: Switch the AI alert widget to acknowledge**

In `web/components/dashboard/widgets/ai-alert-widget.tsx`:
- Change the import to: `import { useMonitor, useAcknowledgeAlert, type AnalystAction, type PersistentAlert } from "@/lib/api/analyst";` and drop the `useAnalyst` import for dismissal (keep it only if still needed for `runAction` — use `useAnalyst().runAction`).
- Change `AlertData` to use `PersistentAlert` and replace `dismiss` with `acknowledge`:

```tsx
type AlertData = {
  alerts: PersistentAlert[];
  top: PersistentAlert | null;
  acknowledge: (id: string) => void;
  runAction: (action: AnalystAction) => void;
};
```

- In `useData`, acquire `const acknowledge = useAcknowledgeAlert();` and `const analyst = useAnalyst();`, and build data without the dismissed filter (server omits resolved alerts):

```tsx
    select: (data): AlertData => {
      const alerts = data.alerts ?? [];
      return { alerts, top: alerts[0] ?? null, acknowledge: (id) => acknowledge.mutate(id), runAction: analyst.runAction };
    },
```

- Replace both `data.dismiss(alert.id)` buttons: in `Body`, change the Dismiss button label/handler to Acknowledge:

```tsx
            <button
              type="button"
              onClick={() => data.acknowledge(alert.id)}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-[11px] text-muted hover:text-fg"
            >
              <Check className="size-3" />
              Acknowledge
            </button>
```

and in `Focus`, change the icon button:

```tsx
              <button type="button" onClick={() => data.acknowledge(alert.id)} className="shrink-0 rounded p-1 text-muted hover:bg-card hover:text-fg" aria-label={`Acknowledge ${alert.title}`}>
                <Check className="size-4" />
              </button>
```

- Update the lucide import: replace `X` with `Check` → `import { Bell, Sparkles, Check } from "lucide-react";`.
- Update the two `insightTone`/`toneClass` references that typed `AnalystAlert["tone"]` to `PersistentAlert["tone"]`.

- [ ] **Step 5: Run the affected tests + typecheck**

Run: `cd web && npx vitest run components/dashboard/analyst/use-analyst.test.tsx components/dashboard/analyst/analyst-pane.test.tsx components/dashboard/widgets && npm run typecheck`
Expected: PASS, typecheck clean

- [ ] **Step 6: Full web suite green**

Run: `cd web && npx vitest run && npm run typecheck`
Expected: PASS, typecheck clean

- [ ] **Step 7: Commit**

```bash
git add web/components/dashboard/analyst/use-analyst.tsx web/components/dashboard/analyst/use-analyst.test.tsx web/components/dashboard/analyst/analyst-pane.test.tsx web/components/dashboard/widgets/ai-alert-widget.tsx
git commit -m "feat(analyst): drop localStorage dismissal; widget acknowledges server-side"
```

---

## Self-Review

**Spec coverage (W2 scope of `docs/superpowers/specs/2026-06-24-analyst-memory-awareness-design.md` §2 + phasing):**
- `analyst_alert` table + state machine (active/acknowledged/resolved, signature, supporting_refs) → Task 1. ✓
- Producer (a) deterministic rules ported to emit `analyst_alert` with stable signatures → Tasks 2 (+5 sync). ✓
- Producer (b) LLM insight pass over assembled context, with citations → Task 4 (+5). ✓
- Upsert by signature; acknowledge sets state but keeps visible; auto-resolve when signature stops re-emitting → Task 3. ✓
- Alerts also written to the `notification` table → Task 5 (`enqueue_notification`). ✓
- Scheduled background run (Celery, daily) producing/updating alerts without the app open → Tasks 5–6. ✓
- Frontend reads alerts from the API (not localStorage), Acknowledge (not dismiss), acknowledged rendered muted but visible, citations shown → Tasks 7–9. ✓
- Out of W2 (correct, deferred to W3): correlation producer (c), `analyst_thread`/`analyst_message` conversation memory, deep structured page context. The engine already supports a `correlation` producer tag so W3 plugs in without schema change. ✓ (noted)

**Placeholder scan:** Task 7 Step 7 (OpenAPI regen) names the consumer (`@shared/api-schema`) and the two candidate commands but depends on the repo's existing export script — it instructs checking `web/package.json`/prior pattern rather than inventing one; this is a real environmental branch, not a TODO. All code steps show full code. No "TBD/handle edge cases".

**Type consistency:** `AlertSpec` fields (kind/producer/severity/tone/signature/title/detail/suggested_action/supporting_refs) are identical across Tasks 2, 3, 4, 5. `sync_alerts(session, household_id, specs, *, producers)` returns `{"created": list, "resolved": int, "updated": int}` in Task 3 and is consumed that way in Task 5. `run_alert_scan(session, user, llm=None, *, from_date, to_date, llm_insights, notify)` signature matches between Tasks 5, 6, 7. ORM class is `AnalystAlertRow` everywhere (Tasks 1/3/5); the pydantic API model is `PersistentAlert` everywhere (Tasks 7/8/9) — no collision with the legacy `AnalystAlert` schema, which is retained only for `derive_alerts`/`test_m19`. Frontend `PersistentAlert` = `components["schemas"]["PersistentAlert"]` with `supporting_refs: {source_type, source_id}[]` matches the backend schema (Task 7).

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-24-analyst-memory-w2-alert-engine.md`.
