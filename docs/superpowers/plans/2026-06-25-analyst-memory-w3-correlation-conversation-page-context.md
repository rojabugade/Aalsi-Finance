# Analyst Memory W3 — Correlation + Conversation + Deep Page Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the analyst-memory feature's third wave — a cross-domain correlation alert producer, server-side conversation memory (threads/messages) so the analyst remembers context across sessions, and structured page-context plumbing from the frontend through the Context Assembler.

**Architecture:** Three additive pillars on top of the W1 memory store and W2 alert engine. (A) A new `correlation` alert producer joins the existing deterministic + insight producers in `run_alert_scan`, reusing `retrieve_chunks` to find transactions that conflict with active health/lifestyle `memory_fact`s and an LLM to judge real correlations. (B) New `analyst_thread`/`analyst_message` tables replace the browser-only thread store; `run_ask` becomes thread-aware (loads recent turns, persists the exchange) and a history endpoint hydrates the UI. (C) A structured `page_context` object (`{route, entity, visible_range, filters}`) flows from the frontend into the assembler's prompt, richer than today's single page string.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 async, Alembic, Postgres + pgvector, Celery, pydantic v2; Next.js + React + TanStack Query + Vitest on the frontend.

## Global Constraints

- All new tables are `household_id`-scoped (directly or via parent thread) and accessed through `scoped_query(Model, user)` for tenant isolation.
- Embedding dim is `settings.embed_dim` (1536); never hardcode it in models — reuse `Vector(_EMBED_DIM)` as `app/models/memory.py` does. Migrations use `_DIM = 1536` to match.
- The analyst is optional: no LLM call, retrieval failure, or provider error may raise out of a producer, `run_ask`, or the monitor feed — wrap in best-effort `try/except` returning empty/`_UNAVAILABLE`, never a 5xx.
- Enum-like columns: declare with `str_enum(...)` in the ORM model; create them in the migration as `sa.String()` + a named `CheckConstraint` (matches `analyst_alert`, `memory_fact`).
- Alert producers emit `AlertSpec` with a **stable** `signature`; the engine upserts by signature and auto-resolves only signatures whose `producer` is in the current run's `producers` set.
- Migrations chain off the current head `e2b3c4d5f6a7` (m22 analyst alert). Register every new model in `app/models/__init__.py` so Alembic and `create_all` see it.
- Backend tests run against Postgres via `TEST_DATABASE_URL` (default `postgresql+asyncpg://finance:finance@localhost:5433/finance`); they `pytest.skip` when no DB is reachable. Tests must keep the existing suite green; `web` vitest + typecheck stay green.
- Plain text only in LLM outputs surfaced to users — no Markdown markers (consistent with `_GROUNDING_RULES`).

---

## File Structure

**Group A — Correlation (no schema change)**
- Create `backend/app/analyst/insight/correlation.py` — correlation producer: `correlation_specs(session, user, llm) -> list[AlertSpec]`.
- Modify `backend/app/analyst/insight/scan.py` — add `correlation` producer to `run_alert_scan`.
- Create `backend/tests/test_m22_correlation.py` — producer + scan integration tests.

**Group B — Conversation memory**
- Create `backend/app/models/conversation.py` — `AnalystThread`, `AnalystMessage` ORM models.
- Create `backend/migrations/versions/f4a1c2d3e5b6_m22_analyst_conversation.py` — tables.
- Modify `backend/app/models/__init__.py` — register the two models.
- Create `backend/app/analyst/conversation.py` — `get_or_create_thread`, `recent_turns`, `append_turn`.
- Modify `backend/app/analyst/schemas.py` — `AnalystAskIn.thread_id`, `AnalystAskOut.thread_id`, `AnalystThreadMessage`, `AnalystThreadOut`.
- Modify `backend/app/analyst/service.py` — thread-aware `run_ask`; add `run_thread_history`.
- Modify `backend/app/analyst/router.py` — add `GET /analyst/thread/{key}/messages`.
- Create `backend/tests/test_m22_conversation.py` — models, service module, thread-aware ask, history.
- Modify `web/lib/api/analyst.ts` — `thread_id` on `AskIn`, `useThreadHistory`, `ThreadMessage`.
- Modify `web/components/dashboard/analyst/chat-thread.tsx` — send `thread_id`, hydrate from server.
- Modify `web/components/dashboard/analyst/chat-thread.test.tsx` — expect `thread_id` in the ask body.
- Regenerate `shared/api-schema.ts` from the live backend.

**Group C — Structured page context**
- Modify `backend/app/analyst/schemas.py` — `PageContext` model + `AnalystAskIn.page_context`.
- Modify `backend/app/analyst/memory/assembler.py` — accept + render `page_context`.
- Modify `backend/app/analyst/service.py` — pass `page_context` into `assemble`.
- Modify `backend/tests/test_m22_memory.py` — assembler renders structured page context.
- Modify `web/components/dashboard/analyst/use-analyst.tsx` — carry `route` + `filters`.
- Modify `web/components/dashboard/analyst/analyst-shell.tsx` — set `route` from pathname.
- Modify `web/components/dashboard/analyst/chat-thread.tsx` — send `page_context`.
- Modify `web/components/dashboard/analyst/analyst-pane.tsx` — pass the structured context down.

---

## Task 1: Correlation producer module

**Files:**
- Create: `backend/app/analyst/insight/correlation.py`
- Test: `backend/tests/test_m22_correlation.py`

**Interfaces:**
- Consumes: `app.analyst.memory.retrieve.retrieve_chunks(session, user, query, llm, limit) -> list[MemoryChunk]` (each has `.source_type`, `.source_id`, `.text`); `app.analyst.insight.specs.AlertSpec`; `app.models.memory.MemoryFact` (`.domain`, `.text`, `.structured`, `.status`, `.id`); `scoped_query`.
- Produces: `correlation_specs(session: AsyncSession, user: User, llm) -> list[AlertSpec]` — emits `kind="correlation"`, `producer="correlation"`, `signature` of the form `correlation:<hash>`, with `supporting_refs` listing the fact + matched transaction rows.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_m22_correlation.py`:

```python
from __future__ import annotations

import os
import uuid
from datetime import date
from decimal import Decimal

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.analyst.insight.correlation import correlation_specs
from app.analyst.insight.engine import list_alerts
from app.analyst.insight.scan import run_alert_scan
from app.analyst.memory.indexer import index_chunks
from app.models.core import Household, User
from app.models.memory import MemoryFact

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL", "postgresql+asyncpg://finance:finance@localhost:5433/finance")
PREFIX = "pytest-m22c-"


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


class _FakeLLM:
    def __init__(self):
        from app.config import get_settings
        self.dim = get_settings().embed_dim

    async def embed(self, texts, **kw):
        items = [texts] if isinstance(texts, str) else list(texts)
        return [[float(len(t) % 7)] + [0.0] * (self.dim - 1) for t in items]


class _CorrLLM(_FakeLLM):
    async def chat(self, messages, **kw):
        return {"found": True, "title": "Peanut allergy vs purchases",
                "detail": "You bought peanut butter despite a peanut allergy.",
                "tone": "danger", "severity": 8}


@pytest.mark.asyncio
async def test_correlation_specs_emits_for_health_fact(session):
    user = await _user(session)
    llm = _CorrLLM()
    await index_chunks(session, user.household_id, "transaction", [(uuid.uuid4(), "bought peanut butter")], llm)
    session.add(MemoryFact(household_id=user.household_id, domain="health",
                           text="allergic to peanuts", structured={"allergen": "peanut"}, status="active"))
    await session.commit()
    specs = await correlation_specs(session, user, llm)
    assert len(specs) == 1
    spec = specs[0]
    assert spec.kind == "correlation" and spec.producer == "correlation"
    assert spec.signature.startswith("correlation:")
    kinds = {r["source_type"] for r in (spec.supporting_refs or [])}
    assert "fact" in kinds and "transaction" in kinds


@pytest.mark.asyncio
async def test_correlation_specs_skips_finance_facts(session):
    user = await _user(session)
    llm = _CorrLLM()
    await index_chunks(session, user.household_id, "transaction", [(uuid.uuid4(), "bought peanut butter")], llm)
    session.add(MemoryFact(household_id=user.household_id, domain="finance",
                           text="freelances with irregular income", status="active"))
    await session.commit()
    assert await correlation_specs(session, user, llm) == []


@pytest.mark.asyncio
async def test_correlation_specs_none_llm_is_empty(session):
    user = await _user(session)
    assert await correlation_specs(session, user, None) == []


@pytest.mark.asyncio
async def test_correlation_specs_respects_not_found(session):
    user = await _user(session)

    class _NoMatchLLM(_FakeLLM):
        async def chat(self, messages, **kw):
            return {"found": False}

    llm = _NoMatchLLM()
    await index_chunks(session, user.household_id, "transaction", [(uuid.uuid4(), "bought milk")], llm)
    session.add(MemoryFact(household_id=user.household_id, domain="health",
                           text="allergic to peanuts", structured={"allergen": "peanut"}, status="active"))
    await session.commit()
    assert await correlation_specs(session, user, llm) == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest backend/tests/test_m22_correlation.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.analyst.insight.correlation'`

- [ ] **Step 3: Write the correlation producer**

Create `backend/app/analyst/insight/correlation.py`:

```python
"""Correlation producer (W3 §2c): for each active health/lifestyle fact, retrieve
the user's transactions that semantically match it and ask the LLM whether any
genuinely conflict with or confirm the fact (e.g. a peanut allergy vs. peanut
purchases). Emits `correlation` AlertSpecs with supporting_refs pointing at the
fact and the matched transactions. Best-effort: no LLM, retrieval failure, or any
provider error yields an empty list so the rest of the scan still flows."""

from __future__ import annotations

import hashlib

from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.analyst.insight.specs import AlertSpec
from app.analyst.memory.retrieve import retrieve_chunks
from app.auth.deps import scoped_query
from app.models.core import User
from app.models.memory import MemoryFact

_TONES = {"positive", "info", "warning", "danger"}
_CORRELATABLE_DOMAINS = ("health", "lifestyle")

_SYSTEM = (
    "You are a cross-domain analyst. You are given ONE durable fact about a user "
    "(a health condition or lifestyle constraint) and a list of their recent "
    "transactions. Decide whether any transactions genuinely conflict with or "
    "confirm the fact (e.g. an allergen being purchased). Report a correlation "
    "ONLY if it is real and specific to the listed transactions; otherwise set "
    "found=false. Never invent transactions or numbers. Use plain text without "
    "Markdown."
)


class _Correlation(BaseModel):
    found: bool = False
    title: str = ""
    detail: str = ""
    tone: str = "warning"
    severity: int = 6


def _clamp_severity(value: int) -> int:
    try:
        return max(1, min(9, int(value)))
    except (TypeError, ValueError):
        return 6


async def _correlatable_facts(session: AsyncSession, user: User) -> list[MemoryFact]:
    rows = (await session.execute(
        scoped_query(MemoryFact, user).where(MemoryFact.status == "active")
    )).scalars().all()
    return [f for f in rows if f.domain in _CORRELATABLE_DOMAINS]


def _fact_query(fact: MemoryFact) -> str:
    terms = [fact.text]
    if isinstance(fact.structured, dict):
        terms += [str(v) for v in fact.structured.values() if v]
    return " ".join(terms)


async def correlation_specs(session: AsyncSession, user: User, llm) -> list[AlertSpec]:
    if llm is None:
        return []
    facts = await _correlatable_facts(session, user)
    specs: list[AlertSpec] = []
    for fact in facts:
        try:
            chunks = await retrieve_chunks(session, user, _fact_query(fact), llm, limit=6)
        except Exception:
            continue
        txns = [c for c in chunks if c.source_type == "transaction"]
        if not txns:
            continue
        body = (
            f"Fact ({fact.domain}): {fact.text}\n\nRecent transactions:\n"
            + "\n".join(f"- [{c.source_id}] {c.text}" for c in txns)
        )
        try:
            result = await llm.chat(
                [{"role": "system", "content": _SYSTEM}, {"role": "user", "content": body}],
                json_schema=_Correlation, purpose="analyst.correlation",
                user_id=user.id, session=session,
            )
            parsed = _Correlation(**result)
        except Exception:  # correlation is best-effort; never break the scan
            continue
        if not parsed.found or not parsed.title.strip():
            continue
        refs: list[dict] = [{"source_type": "fact", "source_id": str(fact.id)}]
        refs += [{"source_type": "transaction", "source_id": str(c.source_id)} for c in txns]
        sig = "correlation:" + hashlib.sha1(
            f"{fact.id}:{parsed.title.strip().lower()}".encode("utf-8")
        ).hexdigest()[:12]
        specs.append(AlertSpec(
            kind="correlation", producer="correlation",
            severity=_clamp_severity(parsed.severity),
            tone=parsed.tone if parsed.tone in _TONES else "warning",
            signature=sig, title=parsed.title.strip(), detail=parsed.detail.strip(),
            supporting_refs=refs,
        ))
    return specs
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest backend/tests/test_m22_correlation.py -v`
Expected: PASS (4 tests; the scan-integration test added in Task 2 is not here yet)

- [ ] **Step 5: Commit**

```bash
git add backend/app/analyst/insight/correlation.py backend/tests/test_m22_correlation.py
git commit -m "feat(analyst): cross-domain correlation alert producer

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Wire correlation into the alert scan

**Files:**
- Modify: `backend/app/analyst/insight/scan.py:30-39`
- Test: `backend/tests/test_m22_correlation.py`

**Interfaces:**
- Consumes: `correlation_specs(session, user, llm)` from Task 1.
- Produces: `run_alert_scan` now includes `"correlation"` in its `producers` set and appends correlation specs when `llm` is present and `llm_insights` is True.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_m22_correlation.py`:

```python
@pytest.mark.asyncio
async def test_run_alert_scan_includes_correlation(session, monkeypatch):
    user = await _user(session)
    llm = _CorrLLM()
    await index_chunks(session, user.household_id, "transaction", [(uuid.uuid4(), "bought peanut butter")], llm)
    session.add(MemoryFact(household_id=user.household_id, domain="health",
                           text="allergic to peanuts", structured={"allergen": "peanut"}, status="active"))
    await session.commit()

    async def clean_snapshot(*a, **k):
        from app.analyst.schemas import FinancialSnapshot
        return FinancialSnapshot(currency="USD", income=0.0, expenses=0.0, net=0.0,
                                 net_worth=0.0, assets=0.0, liabilities=0.0)

    monkeypatch.setattr("app.analyst.insight.scan.build_snapshot", clean_snapshot)
    await run_alert_scan(session, user, llm, llm_insights=True, notify=False)
    rows = await list_alerts(session, user)
    assert any(r.kind == "correlation" and r.producer == "correlation" for r in rows)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_m22_correlation.py::test_run_alert_scan_includes_correlation -v`
Expected: FAIL — no `correlation` alert is created (assertion error)

- [ ] **Step 3: Wire the producer into the scan**

In `backend/app/analyst/insight/scan.py`, add the import near the other producer imports (after `from app.analyst.insight.llm import llm_insight_specs`):

```python
from app.analyst.insight.correlation import correlation_specs
```

Then replace the LLM-insight block inside `run_alert_scan`:

```python
    if llm is not None and llm_insights:
        try:
            ctx = await assemble(session, user, "Surface notable financial issues", llm, from_date, to_date)
        except Exception:
            ctx = None
        specs += await llm_insight_specs(session, user, snapshot, llm, ctx)
        producers.add("insight")
```

with:

```python
    if llm is not None and llm_insights:
        try:
            ctx = await assemble(session, user, "Surface notable financial issues", llm, from_date, to_date)
        except Exception:
            ctx = None
        specs += await llm_insight_specs(session, user, snapshot, llm, ctx)
        producers.add("insight")
        try:
            specs += await correlation_specs(session, user, llm)
        except Exception:  # correlation is best-effort; never break the scan
            pass
        producers.add("correlation")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest backend/tests/test_m22_correlation.py -v`
Expected: PASS (5 tests)

Run the W2 alert suite to confirm no regression: `pytest backend/tests/test_m22_alerts.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/analyst/insight/scan.py backend/tests/test_m22_correlation.py
git commit -m "feat(analyst): add correlation producer to the alert scan

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Conversation tables — models + migration

**Files:**
- Create: `backend/app/models/conversation.py`
- Create: `backend/migrations/versions/f4a1c2d3e5b6_m22_analyst_conversation.py`
- Modify: `backend/app/models/__init__.py`
- Test: `backend/tests/test_m22_conversation.py`

**Interfaces:**
- Produces: `AnalystThread` (`id`, `household_id`, `key`, `created_at`, `updated_at`; unique `(household_id, key)`) and `AnalystMessage` (`id`, `thread_id`, `role` ∈ {`user`,`analyst`}, `text`, `created_at`).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_m22_conversation.py`:

```python
from __future__ import annotations

import os
import uuid

import pytest
import pytest_asyncio
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models.conversation import AnalystMessage, AnalystThread
from app.models.core import Household, User

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL", "postgresql+asyncpg://finance:finance@localhost:5433/finance")
PREFIX = "pytest-m22cv-"


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
async def test_thread_and_message_round_trip(session):
    user = await _user(session)
    thread = AnalystThread(household_id=user.household_id, key="dashboard")
    session.add(thread)
    await session.flush()
    session.add(AnalystMessage(thread_id=thread.id, role="user", text="how am I doing?"))
    session.add(AnalystMessage(thread_id=thread.id, role="analyst", text="Your spending looks steady."))
    await session.commit()
    msgs = (await session.execute(
        select(AnalystMessage).where(AnalystMessage.thread_id == thread.id)
        .order_by(AnalystMessage.created_at.asc())
    )).scalars().all()
    assert [m.role for m in msgs] == ["user", "analyst"]
    assert msgs[0].text == "how am I doing?"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_m22_conversation.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.models.conversation'`

- [ ] **Step 3: Write the ORM models**

Create `backend/app/models/conversation.py`:

```python
"""Server-side analyst conversation memory (W3): per-household threads keyed by a
stable client string plus their ordered messages. Replaces the browser-only
thread store so the analyst remembers context across turns and sessions."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, fk_uuid, str_enum, uuid_pk


class AnalystThread(Base):
    __tablename__ = "analyst_thread"

    id: Mapped[uuid.UUID] = uuid_pk()
    household_id: Mapped[uuid.UUID] = fk_uuid(
        ForeignKey("household.id", ondelete="CASCADE"), index=True, nullable=False
    )
    key: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    __table_args__ = (
        UniqueConstraint("household_id", "key", name="uq_analyst_thread_household_key"),
    )


class AnalystMessage(Base):
    __tablename__ = "analyst_message"

    id: Mapped[uuid.UUID] = uuid_pk()
    thread_id: Mapped[uuid.UUID] = fk_uuid(
        ForeignKey("analyst_thread.id", ondelete="CASCADE"), index=True, nullable=False
    )
    role: Mapped[str] = mapped_column(
        str_enum("analyst_message_role", "user", "analyst"), nullable=False
    )
    text: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
```

- [ ] **Step 4: Write the migration**

Create `backend/migrations/versions/f4a1c2d3e5b6_m22_analyst_conversation.py`:

```python
# backend/migrations/versions/f4a1c2d3e5b6_m22_analyst_conversation.py
"""m22 analyst conversation: analyst_thread, analyst_message

Revision ID: f4a1c2d3e5b6
Revises: e2b3c4d5f6a7
"""
from __future__ import annotations

from typing import Union

import sqlalchemy as sa
from alembic import op

revision: str = "f4a1c2d3e5b6"
down_revision: Union[str, None] = "e2b3c4d5f6a7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "analyst_thread",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("household_id", sa.dialects.postgresql.UUID(as_uuid=True), sa.ForeignKey("household.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("key", sa.String(length=128), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("household_id", "key", name="uq_analyst_thread_household_key"),
    )
    op.create_table(
        "analyst_message",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("thread_id", sa.dialects.postgresql.UUID(as_uuid=True), sa.ForeignKey("analyst_thread.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("role", sa.String(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("role IN ('user','analyst')", name="ck_analyst_message_role"),
    )


def downgrade() -> None:
    op.drop_table("analyst_message")
    op.drop_table("analyst_thread")
```

- [ ] **Step 5: Register the models**

In `backend/app/models/__init__.py`, add after the `alerts` import block (around line 14):

```python
from app.models import conversation  # noqa: F401
from app.models.conversation import AnalystMessage, AnalystThread
```

and add `"AnalystMessage",` and `"AnalystThread",` to the `__all__` list (keep it alphabetical near `"AnalystAlertRow"`).

- [ ] **Step 6: Apply the migration**

Run (against the test/dev Postgres — use the container/compose method your environment documents):

```bash
cd backend && alembic upgrade head
```

Expected: `Running upgrade e2b3c4d5f6a7 -> f4a1c2d3e5b6, m22 analyst conversation`

- [ ] **Step 7: Run test to verify it passes**

Run: `pytest backend/tests/test_m22_conversation.py -v`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add backend/app/models/conversation.py backend/app/models/__init__.py backend/migrations/versions/f4a1c2d3e5b6_m22_analyst_conversation.py backend/tests/test_m22_conversation.py
git commit -m "feat(analyst): analyst_thread + analyst_message tables for conversation memory

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Conversation service module

**Files:**
- Create: `backend/app/analyst/conversation.py`
- Test: `backend/tests/test_m22_conversation.py`

**Interfaces:**
- Consumes: `AnalystThread`, `AnalystMessage` (Task 3); `scoped_query`.
- Produces:
  - `get_or_create_thread(session, user, key: str) -> AnalystThread`
  - `recent_turns(session, thread_id: uuid.UUID, limit: int = 6) -> list[AnalystMessage]` (chronological order: oldest → newest)
  - `append_turn(session, thread_id: uuid.UUID, *, question: str, answer: str) -> None`

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_m22_conversation.py`:

```python
from app.analyst.conversation import append_turn, get_or_create_thread, recent_turns  # noqa: E402


@pytest.mark.asyncio
async def test_get_or_create_thread_is_idempotent(session):
    user = await _user(session)
    t1 = await get_or_create_thread(session, user, "dashboard")
    t2 = await get_or_create_thread(session, user, "dashboard")
    assert t1.id == t2.id


@pytest.mark.asyncio
async def test_append_and_recent_turns_order_and_limit(session):
    user = await _user(session)
    thread = await get_or_create_thread(session, user, "dashboard")
    await append_turn(session, thread.id, question="q1", answer="a1")
    await append_turn(session, thread.id, question="q2", answer="a2")
    await append_turn(session, thread.id, question="q3", answer="a3")
    turns = await recent_turns(session, thread.id, limit=4)
    assert [(m.role, m.text) for m in turns] == [
        ("user", "q2"), ("analyst", "a2"), ("user", "q3"), ("analyst", "a3"),
    ]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest backend/tests/test_m22_conversation.py -k "idempotent or recent_turns" -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.analyst.conversation'`

- [ ] **Step 3: Write the service module**

Create `backend/app/analyst/conversation.py`:

```python
"""Thread/message persistence for the analyst: resolve a stable per-household
thread key to a row, append a user+analyst turn, and load recent turns (oldest
first) for prompt context. Tenant isolation via scoped_query on the thread."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import scoped_query
from app.models.conversation import AnalystMessage, AnalystThread
from app.models.core import User


async def get_or_create_thread(session: AsyncSession, user: User, key: str) -> AnalystThread:
    row = (await session.execute(
        scoped_query(AnalystThread, user).where(AnalystThread.key == key)
    )).scalar_one_or_none()
    if row is None:
        row = AnalystThread(household_id=user.household_id, key=key)
        session.add(row)
        await session.commit()
    return row


async def recent_turns(
    session: AsyncSession, thread_id: uuid.UUID, limit: int = 6
) -> list[AnalystMessage]:
    rows = (await session.execute(
        select(AnalystMessage)
        .where(AnalystMessage.thread_id == thread_id)
        .order_by(AnalystMessage.created_at.desc(), AnalystMessage.id.desc())
        .limit(limit)
    )).scalars().all()
    return list(reversed(rows))


async def append_turn(
    session: AsyncSession, thread_id: uuid.UUID, *, question: str, answer: str
) -> None:
    session.add(AnalystMessage(thread_id=thread_id, role="user", text=question))
    session.add(AnalystMessage(thread_id=thread_id, role="analyst", text=answer))
    await session.commit()
```

> Note: `recent_turns` orders by `created_at` then `id` descending so that the two
> rows of a single turn (written in the same transaction with identical
> server-side timestamps) keep their user-before-analyst order after reversal.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest backend/tests/test_m22_conversation.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/analyst/conversation.py backend/tests/test_m22_conversation.py
git commit -m "feat(analyst): conversation persistence module (threads + turns)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Thread-aware run_ask

**Files:**
- Modify: `backend/app/analyst/schemas.py:66-82` (`AnalystAskIn`, `AnalystAskOut`)
- Modify: `backend/app/analyst/service.py:236-278` (`run_ask`)
- Test: `backend/tests/test_m22_conversation.py`

**Interfaces:**
- Consumes: `get_or_create_thread`, `recent_turns`, `append_turn` (Task 4).
- Produces: `AnalystAskIn.thread_id: str | None`, `AnalystAskOut.thread_id: str | None`; `run_ask` loads up to 6 recent turns into the prompt and persists the new exchange when `thread_id` is set.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_m22_conversation.py`:

```python
from app.analyst.schemas import AnalystAskIn  # noqa: E402
from app.analyst.service import run_ask  # noqa: E402


class _AskLLM:
    def __init__(self):
        from app.config import get_settings
        self.dim = get_settings().embed_dim

    async def embed(self, texts, **kw):
        items = [texts] if isinstance(texts, str) else list(texts)
        return [[float(len(t) % 7)] + [0.0] * (self.dim - 1) for t in items]

    async def chat(self, messages, **kw):
        return {"content": "Your spending looks steady."}


@pytest.mark.asyncio
async def test_run_ask_persists_and_returns_thread(session):
    user = await _user(session)
    data = AnalystAskIn(mode="explain", question="how am I doing?", thread_id="dashboard")
    out = await run_ask(session, user, data, _AskLLM())
    assert out.thread_id == "dashboard"
    thread = await get_or_create_thread(session, user, "dashboard")
    turns = await recent_turns(session, thread.id)
    assert [(m.role, m.text) for m in turns] == [
        ("user", "how am I doing?"), ("analyst", "Your spending looks steady."),
    ]


@pytest.mark.asyncio
async def test_run_ask_without_thread_id_persists_nothing(session):
    user = await _user(session)
    data = AnalystAskIn(mode="explain", question="how am I doing?")
    out = await run_ask(session, user, data, _AskLLM())
    assert out.thread_id is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_m22_conversation.py::test_run_ask_persists_and_returns_thread -v`
Expected: FAIL — `AnalystAskIn` has no `thread_id` field (pydantic `ValidationError`) or `AnalystAskOut.thread_id` missing

- [ ] **Step 3: Add the schema fields**

In `backend/app/analyst/schemas.py`, add `thread_id` to `AnalystAskIn` (after the `page` field):

```python
class AnalystAskIn(BaseModel):
    mode: Mode
    question: str = Field(min_length=1)
    range_from: str | None = None
    range_to: str | None = None
    focus_kind: Literal["merchant", "category"] | None = None
    focus_label: str | None = None
    focus_id: str | None = None
    page: str | None = None
    thread_id: str | None = None
```

and add `thread_id` to `AnalystAskOut`:

```python
class AnalystAskOut(BaseModel):
    answer: str
    suggestions: list[AnalystAction] = Field(default_factory=list)
    available: bool = True
    citations: list[dict] = []
    thread_id: str | None = None
```

- [ ] **Step 4: Make run_ask thread-aware**

In `backend/app/analyst/service.py`, add the import at the top (with the other `app.analyst` imports):

```python
from app.analyst.conversation import append_turn, get_or_create_thread, recent_turns
```

Then replace the body of `run_ask` from the `messages = [...]` assignment through the final `return` with this (keep everything above `messages = [...]` — the greeting guard, `assemble`, and the focus block — unchanged):

```python
    thread_row = None
    if data.thread_id:
        try:
            thread_row = await get_or_create_thread(session, user, data.thread_id)
            history = await recent_turns(session, thread_row.id)
            if history:
                convo = "\n".join(
                    f"{'User' if t.role == 'user' else 'Analyst'}: {t.text}" for t in history
                )
                user_content = f"Conversation so far:\n{convo}\n\n{user_content}"
        except Exception:  # conversation memory is best-effort; never block the answer
            thread_row = None

    messages = [
        {"role": "system", "content": f'{_SYSTEM.get(data.mode, _SYSTEM["explain"])} {_GROUNDING_RULES}'},
        {"role": "user", "content": user_content},
    ]
    citations = [{"source_type": c["source_type"], "source_id": c["source_id"]} for c in ctx.chunks]
    out_thread = data.thread_id if thread_row is not None else None
    try:
        if data.mode == "action":
            result = await llm.chat(
                messages,
                json_schema=AnalystActionResponse,
                purpose="analyst.ask",
                user_id=user.id,
                session=session,
            )
            parsed = AnalystActionResponse(**result)
            answer = parsed.answer
            out = AnalystAskOut(answer=answer, suggestions=parsed.actions, citations=citations, thread_id=out_thread)
        else:
            result = await llm.chat(
                messages, purpose="analyst.ask", user_id=user.id, session=session
            )
            answer = result.get("content") or _UNAVAILABLE
            out = AnalystAskOut(answer=answer, citations=citations, thread_id=out_thread)
    except LLMError:
        return AnalystAskOut(answer=_UNAVAILABLE, suggestions=[], available=False)
    except Exception:  # The optional analyst must never turn a provider response into a 5xx.
        return AnalystAskOut(answer=_UNAVAILABLE, suggestions=[], available=False)

    if thread_row is not None:
        try:
            await append_turn(session, thread_row.id, question=data.question, answer=answer)
        except Exception:  # persistence is best-effort; the answer is already formed
            pass
    return out
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest backend/tests/test_m22_conversation.py -v`
Expected: PASS

Run the analyst regression suites: `pytest backend/tests/test_m19_analyst.py backend/tests/test_m22_memory.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/analyst/schemas.py backend/app/analyst/service.py backend/tests/test_m22_conversation.py
git commit -m "feat(analyst): thread-aware run_ask loads + persists conversation turns

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Thread history endpoint

**Files:**
- Modify: `backend/app/analyst/schemas.py` (add `AnalystThreadMessage`, `AnalystThreadOut`)
- Modify: `backend/app/analyst/service.py` (add `run_thread_history`)
- Modify: `backend/app/analyst/router.py` (add `GET /analyst/thread/{key}/messages`)
- Test: `backend/tests/test_m22_conversation.py`

**Interfaces:**
- Consumes: `get_or_create_thread`, `recent_turns` (Task 4).
- Produces: `run_thread_history(session, user, key, limit=50) -> AnalystThreadOut`; route `GET /analyst/thread/{key}/messages` → `AnalystThreadOut` with `messages: list[{role, text}]` (chronological).

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_m22_conversation.py`:

```python
from app.analyst.service import run_thread_history  # noqa: E402


@pytest.mark.asyncio
async def test_run_thread_history_returns_chronological_messages(session):
    user = await _user(session)
    data = AnalystAskIn(mode="explain", question="hello there", thread_id="dashboard")
    await run_ask(session, user, data, _AskLLM())
    out = await run_thread_history(session, user, "dashboard")
    assert [(m.role, m.text) for m in out.messages] == [
        ("user", "hello there"), ("analyst", "Your spending looks steady."),
    ]


@pytest.mark.asyncio
async def test_run_thread_history_empty_for_unknown_key(session):
    user = await _user(session)
    out = await run_thread_history(session, user, "never-used")
    assert out.messages == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_m22_conversation.py::test_run_thread_history_returns_chronological_messages -v`
Expected: FAIL — `cannot import name 'run_thread_history'`

- [ ] **Step 3: Add the response schemas**

In `backend/app/analyst/schemas.py`, add after `AnalystActionResponse`:

```python
class AnalystThreadMessage(BaseModel):
    role: Literal["user", "analyst"]
    text: str


class AnalystThreadOut(BaseModel):
    messages: list[AnalystThreadMessage] = Field(default_factory=list)
```

- [ ] **Step 4: Add the service function**

In `backend/app/analyst/service.py`, add the schemas to the existing `from app.analyst.schemas import (...)` block: `AnalystThreadMessage`, `AnalystThreadOut`. Then add:

```python
async def run_thread_history(session, user, key: str, limit: int = 50) -> AnalystThreadOut:
    from app.analyst.conversation import get_or_create_thread, recent_turns
    thread = await get_or_create_thread(session, user, key)
    turns = await recent_turns(session, thread.id, limit=limit)
    return AnalystThreadOut(
        messages=[AnalystThreadMessage(role=t.role, text=t.text) for t in turns]
    )
```

- [ ] **Step 5: Add the route**

In `backend/app/analyst/router.py`, add `AnalystThreadOut` to the `from app.analyst.schemas import (...)` block, then add the endpoint after `monitor`:

```python
@router.get("/thread/{key}/messages", response_model=AnalystThreadOut)
async def thread_history(
    key: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await service.run_thread_history(session, user, key)
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pytest backend/tests/test_m22_conversation.py -v`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add backend/app/analyst/schemas.py backend/app/analyst/service.py backend/app/analyst/router.py backend/tests/test_m22_conversation.py
git commit -m "feat(analyst): thread history endpoint for conversation hydration

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Frontend — server-backed conversation hydration

**Files:**
- Modify: `web/lib/api/analyst.ts` (add `thread_id` to `AskIn`, `ThreadMessage`, `useThreadHistory`)
- Modify: `web/components/dashboard/analyst/chat-thread.tsx` (send `thread_id`, hydrate on mount)
- Modify: `web/components/dashboard/analyst/chat-thread.test.tsx` (expect `thread_id` in the body)
- Regenerate: `shared/api-schema.ts`

**Interfaces:**
- Consumes: `GET /analyst/thread/{key}/messages` (Task 6); `AnalystAskIn.thread_id` (Task 5).
- Produces: `ChatThread` sends `thread_id: threadId` on every ask and seeds the local thread store from server history when the store is empty.

- [ ] **Step 1: Regenerate the OpenAPI types**

Bring up the backend (so `/openapi.json` reflects the Task 5–6 changes), then regenerate:

```bash
# start the API however your env documents it, e.g. docker compose up -d api
cd web && npm run gen:api
```

Expected: `shared/api-schema.ts` now contains the `"/analyst/thread/{key}/messages"` path and `AnalystThreadOut` schema. Verify:

```bash
grep -c "analyst/thread" ../shared/api-schema.ts
```

Expected: `>= 1`

- [ ] **Step 2: Write the failing test**

In `web/components/dashboard/analyst/chat-thread.test.tsx`, update the first test's assertion (line 21) to expect the thread id:

```javascript
    expect(mutateAsync).toHaveBeenCalledWith({ mode: "explain", question: "why?", range_from: "2026-01-01", range_to: "2026-03-31", thread_id: "dashboard" });
```

Add a new test inside the `describe("ChatThread", ...)` block:

```javascript
  it("hydrates from server thread history when the local store is empty", async () => {
    render(<ChatThread mode="explain" range={{ from: "2026-06-01", to: "2026-06-30" }} threadId="dashboard" />);
    await waitFor(() => expect(screen.getByText("Earlier answer.")).toBeInTheDocument());
  });
```

At the top of the file, extend the mock to also expose `useThreadHistory` returning one prior analyst message:

```javascript
vi.mock("@/lib/api/analyst", () => ({
  useAnalystAsk: () => ({ mutateAsync, isPending: false }),
  useThreadHistory: () => ({ data: { messages: [{ role: "analyst", text: "Earlier answer." }] } }),
}));
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd web && npm run test -- chat-thread.test.tsx`
Expected: FAIL — `thread_id` not in the ask body, and `useThreadHistory` is not exported / not used

- [ ] **Step 4: Add the API hook**

In `web/lib/api/analyst.ts`, extend the `AskIn` type to include `thread_id` and add the history hook + type. Update the `AskIn` definition:

```typescript
export type AskIn = components["schemas"]["AnalystAskIn"] & {
  focus_kind?: "merchant" | "category";
  focus_label?: string;
  focus_id?: string;
  page?: string;
  thread_id?: string;
};
```

Add near `useAnalystAsk`:

```typescript
export type ThreadMessage = { role: "user" | "analyst"; text: string };

export function useThreadHistory(key: string) {
  return useQuery<{ messages: ThreadMessage[] }>({
    queryKey: ["analyst", "thread", key],
    queryFn: () => unwrap(api.GET("/analyst/thread/{key}/messages", { params: { path: { key } } })),
    staleTime: Infinity,
  });
}
```

- [ ] **Step 5: Wire ChatThread to send thread_id + hydrate**

In `web/components/dashboard/analyst/chat-thread.tsx`:

Update the import on line 6 and add `useEffect`/`useRef` to the React import on line 3:

```typescript
import { useEffect, useRef, useState } from "react";
```

```typescript
import { useAnalystAsk, useThreadHistory, type AnalystAction } from "@/lib/api/analyst";
```

Update the imports from `./thread-store` (line 9) to include `getThread`:

```typescript
import { appendMessage, getThread, useThread } from "./thread-store";
```

Inside the component body, after `const messages = useThread(threadId);`, add hydration:

```typescript
  const history = useThreadHistory(threadId);
  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current || getThread(threadId).length > 0) return;
    const serverMessages = history.data?.messages;
    if (!serverMessages || serverMessages.length === 0) return;
    hydrated.current = true;
    for (const message of serverMessages) {
      appendMessage(threadId, { role: message.role, text: message.text });
    }
  }, [history.data, threadId]);
```

In the `ask.mutateAsync({...})` call (around line 44), add `thread_id`:

```typescript
      const result = await ask.mutateAsync({
        mode,
        question: preamble ? `${preamble}. ${value}` : value,
        range_from: range.from,
        range_to: range.to,
        thread_id: threadId,
        ...(page ? { page } : {}),
        ...(focus ? { focus_kind: focus.kind, focus_label: focus.label, focus_id: focus.id } : {}),
      });
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd web && npm run test -- chat-thread.test.tsx chat-thread-persist.test.tsx`
Expected: PASS

> Note: `chat-thread-persist.test.tsx` mocks only `useAnalystAsk`. After Step 5,
> `ChatThread` also imports `useThreadHistory`; a `vi.mock` that omits it makes the
> named import `undefined`. Update that file's mock factory to also return
> `useThreadHistory: () => ({ data: { messages: [] } })`.

- [ ] **Step 7: Typecheck**

Run: `cd web && npm run typecheck`
Expected: PASS (no errors)

- [ ] **Step 8: Commit**

```bash
git add web/lib/api/analyst.ts web/components/dashboard/analyst/chat-thread.tsx web/components/dashboard/analyst/chat-thread.test.tsx web/components/dashboard/analyst/chat-thread-persist.test.tsx shared/api-schema.ts
git commit -m "feat(analyst): server-backed conversation hydration in the chat thread

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Structured page context — backend

**Files:**
- Modify: `backend/app/analyst/schemas.py` (add `PageContext`, `AnalystAskIn.page_context`)
- Modify: `backend/app/analyst/memory/assembler.py` (accept + render `page_context`)
- Modify: `backend/app/analyst/service.py:242` (pass `page_context` into `assemble`)
- Test: `backend/tests/test_m22_memory.py`

**Interfaces:**
- Produces: `PageContext` = `{route: str | None, entity: str | None, visible_range: str | None, filters: dict | None}`; `AnalystAskIn.page_context: PageContext | None`; `assemble(..., page_context: dict | None = None)`; `to_prompt` renders a "Current view" block when present.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_m22_memory.py`:

```python
# ---------------------------------------------------------------------------
# Task 8 (W3): structured page context in the assembler
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_assemble_renders_structured_page_context(session):
    user = await _user(session)
    llm = _FakeLLM()
    ctx = await assemble(
        session, user, "why is dining up", llm, date(2026, 6, 1), date(2026, 6, 30),
        page_context={"route": "/transactions", "entity": "Dining",
                      "visible_range": "2026-06-01..2026-06-30",
                      "filters": {"category": "Dining"}},
    )
    body = to_prompt(ctx)
    assert "/transactions" in body and "Dining" in body
    assert "Current view" in body
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_m22_memory.py::test_assemble_renders_structured_page_context -v`
Expected: FAIL — `assemble()` got an unexpected keyword argument `page_context`

- [ ] **Step 3: Add the PageContext schema**

In `backend/app/analyst/schemas.py`, add before `AnalystAskIn`:

```python
class PageContext(BaseModel):
    """Structured description of what the user is looking at, richer than the
    legacy `page` label: the route, the focused entity, the visible date range,
    and any active filters."""
    route: str | None = None
    entity: str | None = None
    visible_range: str | None = None
    filters: dict[str, Any] | None = None
```

and add the field to `AnalystAskIn` (after `thread_id`):

```python
    page_context: PageContext | None = None
```

- [ ] **Step 4: Render page context in the assembler**

In `backend/app/analyst/memory/assembler.py`, extend `AssembledContext` and `assemble`/`to_prompt`.

Update the model:

```python
class AssembledContext(BaseModel):
    snapshot: dict
    chunks: list[dict]
    facts: list[dict]
    page: str | None = None
    page_context: dict | None = None
```

Update the `assemble` signature and return (add `page_context` param after `page`):

```python
async def assemble(
    session: AsyncSession,
    user: User,
    question: str,
    llm,
    from_date: date,
    to_date: date,
    page: str | None = None,
    max_chunks: int = 8,
    page_context: dict | None = None,
) -> AssembledContext:
    snapshot = await build_snapshot(session, user, from_date, to_date)
    chunks = await retrieve_chunks(session, user, question, llm, limit=max_chunks)
    facts = await active_facts(session, user)
    return AssembledContext(
        snapshot=snapshot.model_dump(),
        chunks=[
            {"source_type": c.source_type, "source_id": str(c.source_id), "text": c.text}
            for c in chunks
        ],
        facts=[{"domain": f.domain, "text": f.text} for f in facts],
        page=page,
        page_context=page_context,
    )
```

Replace the trailing `page` block in `to_prompt` with one that prefers the structured context:

```python
    if ctx.page_context:
        pc = ctx.page_context
        bits = []
        if pc.get("route"):
            bits.append(f"route {pc['route']}")
        if pc.get("entity"):
            bits.append(f"viewing '{pc['entity']}'")
        if pc.get("visible_range"):
            bits.append(f"visible range {pc['visible_range']}")
        if pc.get("filters"):
            bits.append(f"filters {json.dumps(pc['filters'])}")
        if bits:
            parts.append("Current view: " + "; ".join(bits) + ".")
    elif ctx.page:
        parts.append(f"The user is currently on the {ctx.page} page.")
    return "\n\n".join(parts)
```

- [ ] **Step 5: Pass page_context through run_ask**

In `backend/app/analyst/service.py`, update the `assemble(...)` call in `run_ask` (line ~242) to forward the structured context:

```python
    ctx = await assemble(
        session, user, data.question, llm, frm, to,
        page=data.page,
        page_context=data.page_context.model_dump() if data.page_context else None,
    )
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pytest backend/tests/test_m22_memory.py -v`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add backend/app/analyst/schemas.py backend/app/analyst/memory/assembler.py backend/app/analyst/service.py backend/tests/test_m22_memory.py
git commit -m "feat(analyst): structured page context flows through the assembler

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Structured page context — frontend

**Files:**
- Modify: `web/components/dashboard/analyst/use-analyst.tsx` (add `route` + `filters`)
- Modify: `web/components/dashboard/analyst/analyst-shell.tsx` (set `route` from pathname)
- Modify: `web/components/dashboard/analyst/analyst-pane.tsx` (pass structured context down)
- Modify: `web/components/dashboard/analyst/chat-thread.tsx` (send `page_context`)
- Modify: `web/components/dashboard/analyst/chat-thread.test.tsx` (assert `page_context` shape)
- Regenerate: `shared/api-schema.ts`

**Interfaces:**
- Consumes: `AnalystAskIn.page_context` (Task 8).
- Produces: `ChatThread` accepts a `pageContext?: { route?, entity?, visibleRange?, filters? }` prop and sends it as `page_context`; `useAnalyst` exposes `route` + `setRoute` + `filters` + `setFilters`; `AnalystShell` keeps `route` synced to `pathname`.

- [ ] **Step 1: Regenerate OpenAPI types (picks up PageContext)**

```bash
# backend running with Task 8 changes
cd web && npm run gen:api
grep -c "PageContext" ../shared/api-schema.ts
```

Expected: `>= 1`

- [ ] **Step 2: Write the failing test**

In `web/components/dashboard/analyst/chat-thread.test.tsx`, add a test inside `describe("ChatThread", ...)`:

```javascript
  it("sends structured page_context when provided", async () => {
    render(
      <ChatThread mode="explain" range={{ from: "2026-06-01", to: "2026-06-30" }} threadId="dashboard"
        pageContext={{ route: "/transactions", entity: "Dining", visibleRange: "2026-06-01..2026-06-30", filters: { category: "Dining" } }} />,
    );
    fireEvent.change(screen.getByPlaceholderText(/ask/i), { target: { value: "why up?" } });
    fireEvent.submit(screen.getByTestId("analyst-composer"));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      page_context: { route: "/transactions", entity: "Dining", visible_range: "2026-06-01..2026-06-30", filters: { category: "Dining" } },
    }));
  });
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd web && npm run test -- chat-thread.test.tsx`
Expected: FAIL — `ChatThread` has no `pageContext` prop / `page_context` not sent

- [ ] **Step 4: Accept + send page_context in ChatThread**

In `web/components/dashboard/analyst/chat-thread.tsx`, add the prop to the type:

```typescript
  pageContext?: { route?: string; entity?: string; visibleRange?: string; filters?: Record<string, unknown> } | null;
```

Destructure it in the component signature (add `pageContext,` next to `page,`). Then, in the `ask.mutateAsync({...})` call, build and send `page_context`:

```typescript
      const result = await ask.mutateAsync({
        mode,
        question: preamble ? `${preamble}. ${value}` : value,
        range_from: range.from,
        range_to: range.to,
        thread_id: threadId,
        ...(page ? { page } : {}),
        ...(focus ? { focus_kind: focus.kind, focus_label: focus.label, focus_id: focus.id } : {}),
        ...(pageContext
          ? { page_context: {
              route: pageContext.route ?? null,
              entity: pageContext.entity ?? null,
              visible_range: pageContext.visibleRange ?? null,
              filters: pageContext.filters ?? null,
            } }
          : {}),
      });
```

Add `page_context` to the `AskIn` extension type in `web/lib/api/analyst.ts`:

```typescript
  page_context?: {
    route?: string | null;
    entity?: string | null;
    visible_range?: string | null;
    filters?: Record<string, unknown> | null;
  };
```

- [ ] **Step 5: Expose route + filters from useAnalyst**

In `web/components/dashboard/analyst/use-analyst.tsx`, add to `AnalystContextValue`:

```typescript
  /** Current route path, for structured page context. */
  route: string;
  setRoute: (route: string) => void;
  /** Active filters on the current page, for structured page context. */
  filters: Record<string, unknown> | null;
  setFilters: (filters: Record<string, unknown> | null) => void;
```

Add state inside `AnalystProvider`:

```typescript
  const [route, setRoute] = useState("/");
  const [filters, setFilters] = useState<Record<string, unknown> | null>(null);
```

Add `route, setRoute, filters, setFilters` to the `useMemo` value object, and add `route, filters` to its dependency array.

- [ ] **Step 6: Sync route in AnalystShell**

In `web/components/dashboard/analyst/analyst-shell.tsx`, pull `setRoute` from `useAnalyst()` and set it alongside `setPage`:

```typescript
  const { setPage, setRoute } = useAnalyst();
  const pathname = usePathname();

  useEffect(() => {
    setPage(pageLabelFromPath(pathname));
    setRoute(pathname);
  }, [pathname, setPage, setRoute]);
```

- [ ] **Step 7: Pass the structured context down in AnalystPane**

In `web/components/dashboard/analyst/analyst-pane.tsx`, pull the new values and pass a `pageContext` to `ChatThread`:

```typescript
  const { open, mode, setMode, closePane, runAction, range, focus, page, route, filters } = useAnalyst();
```

Update the `ChatThread` render (line ~120):

```typescript
          {mode === "monitor" ? <MonitorFeed range={range} /> : (
            <ChatThread
              mode={mode} range={range} threadId="dashboard" focus={focus} page={page}
              pageContext={{ route, entity: focus?.label, visibleRange: `${range.from}..${range.to}`, filters }}
              onAction={runAction}
            />
          )}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd web && npm run test -- chat-thread.test.tsx use-analyst.test.tsx`
Expected: PASS

- [ ] **Step 9: Typecheck + full frontend test sweep**

Run: `cd web && npm run typecheck && npm run test`
Expected: PASS (vitest suite green)

- [ ] **Step 10: Commit**

```bash
git add web/components/dashboard/analyst/use-analyst.tsx web/components/dashboard/analyst/analyst-shell.tsx web/components/dashboard/analyst/analyst-pane.tsx web/components/dashboard/analyst/chat-thread.tsx web/components/dashboard/analyst/chat-thread.test.tsx web/lib/api/analyst.ts shared/api-schema.ts
git commit -m "feat(analyst): plumb structured page context from the UI into the analyst

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] **Backend suite**

Run: `pytest backend/tests/test_m19_analyst.py backend/tests/test_m22_memory.py backend/tests/test_m22_alerts.py backend/tests/test_m22_correlation.py backend/tests/test_m22_conversation.py -v`
Expected: all PASS (or skip cleanly when no Postgres)

- [ ] **Frontend suite + typecheck**

Run: `cd web && npm run typecheck && npm run test`
Expected: PASS

- [ ] **Migration round-trip sanity**

Run: `cd backend && alembic upgrade head && alembic downgrade -1 && alembic upgrade head`
Expected: clean up/down/up of `f4a1c2d3e5b6` with no errors

---

## Self-Review Notes (spec coverage)

- **W3 correlation pass** (spec §2c) → Tasks 1–2. At least one real cross-domain correlation alert fires from a health fact + matching transaction (success criterion #3).
- **Server-side conversation memory** (`analyst_thread`/`analyst_message`) → Tasks 3–7. `run_ask` loads recent turns + persists exchanges; UI hydrates from the history endpoint, replacing the browser-only store as the source of truth on (re)mount.
- **Structured page context** (`{route, entity, visibleRange, filters}`) → Tasks 8–9. Flows frontend → `AnalystAskIn.page_context` → assembler "Current view" block. The legacy `page` string still works as a fallback.
- **Privacy / grounding / citations** are inherited from W1/W2 and unchanged; correlation alerts carry `supporting_refs` (fact + transactions) consistent with the existing citation model.
- **Tests stay green** — each task ends with a passing run; final verification re-runs the full analyst surface.
