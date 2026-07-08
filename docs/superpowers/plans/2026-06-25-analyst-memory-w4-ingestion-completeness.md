# Analyst Memory & Awareness — Wave 4 (Ingestion & Completeness) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the analyst's "sees everything" promise real — fill `memory_chunk` automatically on every write, self-heal nightly, complete the snapshot with stocks + income, retrieve recent rows reliably, and expose memory coverage in Settings.

**Architecture:** A new `app/analyst/memory/ingest.py` owns an `index_source(session, household_id, source_type, source_ids, llm)` dispatcher that loads + renders rows of one type and upserts them through the existing `index_chunks`. Write paths (transactions confirm/create, loans create/patch, recurring create/patch) fire a best-effort Celery task `analyst.index_source` after commit, so request latency is untouched. A new `app/analyst/memory/reconcile.py` gap-fills any rows lacking a chunk; a daily beat task `analyst.reindex_daily` runs it across all households. `index_chunks` and the assembler gain a `meta` (source-date) channel so retrieval can always include the N most-recent transactions alongside the semantic top-K. `build_snapshot` gains `holdings` + `income_sources`, and a new `GET /analyst/memory/status` + extended `POST /analyst/reindex` back a Settings "Memory" card.

**Tech Stack:** FastAPI, SQLAlchemy (async), Celery + Redis beat, the M3 `LLMClient.embed/chat` gateway, pgvector + JSONB; web is Next.js + TanStack Query + Vitest + `openapi-typescript`.

## Global Constraints

- All chunk/row reads are household-scoped: incremental + reconcile paths filter `Model.household_id == household_id`; request-time reads use `app.auth.deps.scoped_query`. (tenant isolation is mandatory)
- The analyst is **optional**: every embedding/LLM/enqueue failure must degrade gracefully and never raise a 5xx — match the `except LLMError` / bare `except Exception` handling already in `app/analyst/service.py` and `index_chunks`. Enqueue-on-write must be wrapped so a dead broker never breaks a transaction/loan/recurring write.
- **No DB migration.** `memory_chunk.meta` (JSONB) and the `memory_source_type` enum values `transaction`/`loan`/`recurring` already exist (`app/models/memory.py`). Do not add source types for holdings/income — the snapshot covers them.
- Money is `NUMERIC(18,2)`; currency is a 3-letter ISO string. Snapshot floats go through the existing `_f(...)` helper in `snapshot.py`.
- Celery task args must be JSON-serializable: pass `household_id` and `source_ids` as **strings**, `source_type` as a string; convert to `uuid.UUID` inside the task.
- Backend tests connect to `TEST_DATABASE_URL` (default `postgresql+asyncpg://finance:finance@localhost:5433/finance`) and `pytest.skip` when Postgres is unreachable. Reuse the `engine`/`session`/`_user` fixtures and `_FakeLLM` from `tests/test_m22_memory.py`; new DB rows live under a `pytest-m22w4-` household-name prefix so cleanup is a single `DELETE FROM household WHERE name LIKE 'pytest-m22w4-%'`.
- Run backend tests in the api container (local `.venv` is x86_64/broken): `docker compose exec api pytest <path> -v`. If the image is stale, `docker compose build api` first.
- Web tests/typecheck run from `web/`: `npx vitest run <path>` and `npm run typecheck`. Regenerating types needs the backend up on `:8000`, then `npm run gen:api`.

---

### Task 1: `index_chunks` carries per-chunk `meta` (recency channel)

**Files:**
- Modify: `backend/app/analyst/memory/indexer.py:16-65`
- Test: `backend/tests/test_m22_w4_ingestion.py` (create)

**Interfaces:**
- Produces: `index_chunks(session, household_id, source_type, items, llm, *, metas: list[dict | None] | None = None) -> int`. `metas`, when given, is parallel to `items` and is stored on each `MemoryChunk.meta`; when omitted, `meta` stays `NULL`. Existing 2-tuple callers and tests keep working unchanged.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_m22_w4_ingestion.py`:

```python
# backend/tests/test_m22_w4_ingestion.py
from __future__ import annotations

import os
import uuid
from datetime import date
from decimal import Decimal
from types import SimpleNamespace

import pytest
import pytest_asyncio
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import get_settings
from app.models.core import Household, User
from app.models.memory import MemoryChunk

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL", "postgresql+asyncpg://finance:finance@localhost:5433/finance")
PREFIX = "pytest-m22w4-"


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
    """Deterministic embeddings of the configured dim for tests."""
    def __init__(self):
        self.dim = get_settings().embed_dim

    async def embed(self, texts, **kw):
        items = [texts] if isinstance(texts, str) else list(texts)
        return [[float(len(t) % 7)] + [0.0] * (self.dim - 1) for t in items]


@pytest.mark.asyncio
async def test_index_chunks_stores_meta(session):
    from app.analyst.memory.indexer import index_chunks

    user = await _user(session)
    sid = uuid.uuid4()
    n = await index_chunks(
        session, user.household_id, "transaction",
        [(sid, "spent 5 USD")], _FakeLLM(), metas=[{"date": "2026-06-20"}],
    )
    row = (await session.execute(select(MemoryChunk).where(MemoryChunk.source_id == sid))).scalar_one()
    assert n == 1
    assert row.meta == {"date": "2026-06-20"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec api pytest tests/test_m22_w4_ingestion.py::test_index_chunks_stores_meta -v`
Expected: FAIL — `index_chunks() got an unexpected keyword argument 'metas'`.

- [ ] **Step 3: Add the `metas` parameter**

In `backend/app/analyst/memory/indexer.py`, change the signature and the insert loop:

```python
async def index_chunks(
    session: AsyncSession,
    household_id: uuid.UUID,
    source_type: str,
    items: list[tuple[uuid.UUID, str]],
    llm,
    *,
    metas: list[dict | None] | None = None,
) -> int:
```

Then replace the insert loop (currently lines 54-63) with:

```python
    metas = metas if metas is not None else [None] * len(items)
    for (sid, txt), vec, meta in zip(items, vectors, metas):
        session.add(
            MemoryChunk(
                household_id=household_id,
                source_type=source_type,
                source_id=sid,
                text=txt,
                embedding=vec,
                meta=meta,
            )
        )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `docker compose exec api pytest tests/test_m22_w4_ingestion.py::test_index_chunks_stores_meta -v`
Expected: PASS.

- [ ] **Step 5: Confirm no regression in the existing memory suite**

Run: `docker compose exec api pytest tests/test_m22_memory.py -v`
Expected: PASS (2-tuple callers unaffected).

- [ ] **Step 6: Commit**

```bash
git add backend/app/analyst/memory/indexer.py backend/tests/test_m22_w4_ingestion.py
git commit -m "feat(analyst): index_chunks stores per-chunk meta for recency"
```

---

### Task 2: `index_source` dispatcher (render + index one source type by id)

**Files:**
- Create: `backend/app/analyst/memory/ingest.py`
- Test: `backend/tests/test_m22_w4_ingestion.py`

**Interfaces:**
- Consumes: `index_chunks(..., metas=...)` from Task 1; the renderers `render_transaction/render_loan/render_recurring` in `app/analyst/memory/render.py`.
- Produces:
  - `async index_source(session, household_id: uuid.UUID, source_type: str, source_ids: list[uuid.UUID], llm) -> int` — loads household-scoped rows of `source_type` whose id is in `source_ids`, renders each to a grounded sentence with a `{"date": ...}` meta, and upserts via `index_chunks`. Unknown/empty → returns 0.
  - `def enqueue_index_source(household_id, source_type, source_ids) -> None` — best-effort `.delay` of the Celery task (Task 3); swallows every exception.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_m22_w4_ingestion.py`:

```python
@pytest.mark.asyncio
async def test_index_source_indexes_loan_with_date_meta(session):
    from app.analyst.memory.ingest import index_source
    from app.models.debt import Loan

    user = await _user(session)
    loan = Loan(
        household_id=user.household_id, name="Auto Loan", type="auto",
        schedule_kind="emi", principal=Decimal("12000.00"), currency="USD",
        interest_rate=Decimal("7.0"), min_or_emi_amount=Decimal("300.00"),
        start_date=date(2026, 1, 1),
    )
    session.add(loan)
    await session.commit()

    n = await index_source(session, user.household_id, "loan", [loan.id], _FakeLLM())
    row = (await session.execute(
        select(MemoryChunk).where(MemoryChunk.source_id == loan.id))).scalar_one()
    assert n == 1
    assert row.source_type == "loan"
    assert "Auto Loan" in row.text
    assert row.meta == {"date": "2026-01-01"}


@pytest.mark.asyncio
async def test_index_source_unknown_type_is_noop(session):
    from app.analyst.memory.ingest import index_source

    user = await _user(session)
    n = await index_source(session, user.household_id, "nope", [uuid.uuid4()], _FakeLLM())
    assert n == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec api pytest tests/test_m22_w4_ingestion.py -k index_source -v`
Expected: FAIL — `ModuleNotFoundError: app.analyst.memory.ingest`.

- [ ] **Step 3: Write the dispatcher**

Create `backend/app/analyst/memory/ingest.py`:

```python
"""Incremental memory ingestion: render + index the rows touched by a single
write, by id. Shared by the on-write Celery task (analyst.index_source) and the
nightly reconcile. Household-scoped by household_id (no User needed), so it runs
cleanly from a background worker."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.analyst.memory import render
from app.analyst.memory.indexer import index_chunks
from app.models.debt import Loan
from app.models.transactions import Category, Merchant, RecurringSeries, Transaction


def _iso(value) -> str | None:
    return value.isoformat() if value is not None else None


async def _load_and_render(
    session: AsyncSession, household_id: uuid.UUID, source_type: str, source_ids: list[uuid.UUID]
) -> list[tuple[uuid.UUID, str, dict]]:
    if not source_ids:
        return []
    if source_type == "transaction":
        rows = list((await session.execute(
            select(Transaction).where(
                Transaction.household_id == household_id, Transaction.id.in_(source_ids)
            )
        )).scalars().all())
        merchant_ids = {r.merchant_id for r in rows if r.merchant_id}
        category_ids = {r.category_id for r in rows if r.category_id}
        merchants = {
            m.id: m.canonical_name for m in (await session.execute(
                select(Merchant).where(Merchant.id.in_(merchant_ids)))).scalars().all()
        } if merchant_ids else {}
        cats = {
            c.id: c.name for c in (await session.execute(
                select(Category).where(Category.id.in_(category_ids)))).scalars().all()
        } if category_ids else {}
        return [
            (r.id,
             render.render_transaction(r, merchant=merchants.get(r.merchant_id), category=cats.get(r.category_id)),
             {"date": _iso(r.txn_date)})
            for r in rows
        ]
    if source_type == "loan":
        rows = list((await session.execute(
            select(Loan).where(Loan.household_id == household_id, Loan.id.in_(source_ids)))).scalars().all())
        return [(r.id, render.render_loan(r), {"date": _iso(r.start_date)}) for r in rows]
    if source_type == "recurring":
        rows = list((await session.execute(
            select(RecurringSeries).where(
                RecurringSeries.household_id == household_id, RecurringSeries.id.in_(source_ids)
            ))).scalars().all())
        return [(r.id, render.render_recurring(r), {"date": _iso(r.next_due_date)}) for r in rows]
    return []


async def index_source(
    session: AsyncSession, household_id: uuid.UUID, source_type: str,
    source_ids: list[uuid.UUID], llm,
) -> int:
    items = await _load_and_render(session, household_id, source_type, source_ids)
    if not items:
        return 0
    pairs = [(sid, txt) for sid, txt, _ in items]
    metas = [meta for _, _, meta in items]
    return await index_chunks(session, household_id, source_type, pairs, llm, metas=metas)


def enqueue_index_source(household_id, source_type: str, source_ids) -> None:
    """Best-effort fire-and-forget. A dead broker must never break the write."""
    ids = [str(s) for s in source_ids if s is not None]
    if not ids:
        return
    try:
        from app.tasks.analyst import index_source_task
        index_source_task.delay(str(household_id), source_type, ids)
    except Exception:
        pass
```

- [ ] **Step 4: Run test to verify it passes**

Run: `docker compose exec api pytest tests/test_m22_w4_ingestion.py -k index_source -v`
Expected: PASS (both `test_index_source_indexes_loan_with_date_meta` and `test_index_source_unknown_type_is_noop`).

- [ ] **Step 5: Commit**

```bash
git add backend/app/analyst/memory/ingest.py backend/tests/test_m22_w4_ingestion.py
git commit -m "feat(analyst): index_source dispatcher renders + indexes rows by id"
```

---

### Task 3: Celery `analyst.index_source` task + wire it into the write paths

**Files:**
- Modify: `backend/app/tasks/analyst.py`
- Modify: `backend/app/transactions/service.py:217-219` (create), `:349-358` (confirm)
- Modify: `backend/app/loans/service.py:78-80` (create), `:92-94` (patch)
- Modify: `backend/app/widget_data/service.py:153-160` (create_recurring), `:169-178` (patch_recurring)
- Test: `backend/tests/test_m22_w4_ingestion.py`

**Interfaces:**
- Consumes: `index_source` + `enqueue_index_source` from Task 2; `get_household_llm_client` from `app.llm.client`; `SessionLocal` from `app.db`.
- Produces: Celery task `index_source_task` (name `"analyst.index_source"`), signature `(household_id: str, source_type: str, source_ids: list[str]) -> dict` returning `{"indexed": int}`.

- [ ] **Step 1: Write the failing test (unit-level, no broker)**

The Celery task body is thin; test the `_index_source` coroutine it wraps so no worker/broker is needed. Append to `backend/tests/test_m22_w4_ingestion.py`:

```python
@pytest.mark.asyncio
async def test_index_source_task_coro_indexes_confirmed_txn(session, monkeypatch):
    import app.tasks.analyst as analyst_tasks
    from app.models.transactions import Transaction

    user = await _user(session)
    txn = Transaction(household_id=user.household_id, amount=Decimal("9.99"),
                      currency="USD", txn_date=date(2026, 6, 2), status="confirmed")
    session.add(txn)
    await session.commit()

    # Run the task's coroutine against the test session + fake LLM (skip SessionLocal/broker).
    class _Ctx:
        async def __aenter__(self):
            return session
        async def __aexit__(self, *a):
            return False

    monkeypatch.setattr(analyst_tasks, "SessionLocal", lambda: _Ctx())

    async def _fake_llm(_session, _household_id):
        return _FakeLLM()

    monkeypatch.setattr(analyst_tasks, "get_household_llm_client", _fake_llm)

    out = await analyst_tasks._index_source(str(user.household_id), "transaction", [str(txn.id)])
    row = (await session.execute(
        select(MemoryChunk).where(MemoryChunk.source_id == txn.id))).scalar_one()
    assert out == {"indexed": 1}
    assert "9.99" in row.text
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec api pytest tests/test_m22_w4_ingestion.py::test_index_source_task_coro_indexes_confirmed_txn -v`
Expected: FAIL — `module 'app.tasks.analyst' has no attribute '_index_source'`.

- [ ] **Step 3: Add the Celery task**

In `backend/app/tasks/analyst.py`, add these imports near the top (keep the existing ones):

```python
import uuid

from app.analyst.memory.ingest import index_source
from app.llm.client import get_household_llm_client
```

Then append the task + coroutine:

```python
@celery.task(name="analyst.index_source")
def index_source_task(household_id: str, source_type: str, source_ids: list[str]) -> dict:
    return asyncio.run(_index_source(household_id, source_type, source_ids))


async def _index_source(household_id: str, source_type: str, source_ids: list[str]) -> dict:
    hh = uuid.UUID(household_id)
    ids = [uuid.UUID(s) for s in source_ids]
    async with SessionLocal() as session:
        llm = await get_household_llm_client(session, hh)
        return {"indexed": await index_source(session, hh, source_type, ids, llm)}
```

- [ ] **Step 4: Register the task import on the Celery app**

In `backend/app/celery_app.py`, the `analyst` module is already imported (`imports=(..., "app.tasks.analyst")`). No change needed here — verify the tuple still contains `"app.tasks.analyst"`.

- [ ] **Step 5: Run test to verify it passes**

Run: `docker compose exec api pytest tests/test_m22_w4_ingestion.py::test_index_source_task_coro_indexes_confirmed_txn -v`
Expected: PASS.

- [ ] **Step 6: Wire the transaction write paths**

In `backend/app/transactions/service.py`, add the import near the other local imports at module top:

```python
from app.analyst.memory.ingest import enqueue_index_source
```

In `confirm_transaction` (currently ends at line 358), insert before `return txn`:

```python
    enqueue_index_source(user.household_id, "transaction", [txn.id])
    return txn
```

In `create_transaction` (ends at line 219), insert before `return txn`:

```python
    if txn.status == "confirmed":
        enqueue_index_source(user.household_id, "transaction", [txn.id])
    return txn
```

- [ ] **Step 7: Wire the loan write paths**

In `backend/app/loans/service.py`, add the import near the top:

```python
from app.analyst.memory.ingest import enqueue_index_source
```

In `create_loan` (line 78-80), change the tail to enqueue before returning:

```python
    await session.refresh(loan)
    enqueue_index_source(user.household_id, "loan", [loan.id])
    return await _loan_out(session, loan)
```

In `patch_loan` (line 92-94), same:

```python
    await session.refresh(loan)
    enqueue_index_source(user.household_id, "loan", [loan.id])
    return await _loan_out(session, loan)
```

- [ ] **Step 8: Wire the recurring write paths**

In `backend/app/widget_data/service.py`, add the import near the top:

```python
from app.analyst.memory.ingest import enqueue_index_source
```

In `create_recurring` (line 153-160), insert before the return:

```python
    session.add(row)
    await session.commit()
    enqueue_index_source(user.household_id, "recurring", [row.id])
    return await _recurring_out(session, row)
```

In `patch_recurring` (line 169-178), insert before the return:

```python
    await session.commit()
    enqueue_index_source(user.household_id, "recurring", [row.id])
    return await _recurring_out(session, row)
```

- [ ] **Step 9: Verify the wired modules still import and their suites pass**

Run: `docker compose exec api pytest tests/test_m22_w4_ingestion.py tests/test_m19_analyst.py -v`
Expected: PASS. (Enqueue is best-effort; with no worker running it no-ops, so existing service tests are unaffected.)

- [ ] **Step 10: Commit**

```bash
git add backend/app/tasks/analyst.py backend/app/transactions/service.py backend/app/loans/service.py backend/app/widget_data/service.py backend/tests/test_m22_w4_ingestion.py
git commit -m "feat(analyst): enqueue incremental memory indexing on write"
```

---

### Task 4: Nightly reconcile (gap-fill) + `analyst.reindex_daily` beat + all-source reindex

**Files:**
- Create: `backend/app/analyst/memory/reconcile.py`
- Modify: `backend/app/analyst/service.py:41-43` (`run_reindex`)
- Modify: `backend/app/tasks/analyst.py` (add `reindex_daily` task)
- Modify: `backend/app/celery_app.py:29-46` (beat entry)
- Test: `backend/tests/test_m22_w4_ingestion.py`

**Interfaces:**
- Consumes: `index_source` (Task 2); `MemoryChunk`; `Transaction`/`Loan`/`RecurringSeries` models.
- Produces:
  - `async reconcile_source(session, household_id, source_type, llm) -> int` — indexes only rows of `source_type` that currently have **no** `memory_chunk` (gap-fill). Transactions are restricted to `status == "confirmed"`.
  - `async reconcile_household(session, household_id, llm) -> dict[str, int]` — runs all three, returns `{"transaction": n, "loan": n, "recurring": n}`.
  - `run_reindex(session, user, llm) -> dict` now returns `{"transactions": n, "loans": n, "recurring": n}`.
  - Celery task `reindex_daily` (name `"analyst.reindex_daily"`).

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_m22_w4_ingestion.py`:

```python
@pytest.mark.asyncio
async def test_reconcile_fills_only_missing_chunks(session):
    from app.analyst.memory.ingest import index_source
    from app.analyst.memory.reconcile import reconcile_household
    from app.models.transactions import Transaction

    user = await _user(session)
    already = Transaction(household_id=user.household_id, amount=Decimal("1.00"),
                          currency="USD", txn_date=date(2026, 6, 1), status="confirmed")
    missing = Transaction(household_id=user.household_id, amount=Decimal("2.00"),
                          currency="USD", txn_date=date(2026, 6, 2), status="confirmed")
    draft = Transaction(household_id=user.household_id, amount=Decimal("3.00"),
                        currency="USD", txn_date=date(2026, 6, 3), status="draft")
    session.add_all([already, missing, draft])
    await session.commit()

    # Pre-index `already`; reconcile must skip it and index only `missing`.
    await index_source(session, user.household_id, "transaction", [already.id], _FakeLLM())
    counts = await reconcile_household(session, user.household_id, _FakeLLM())

    rows = (await session.execute(select(MemoryChunk).where(
        MemoryChunk.household_id == user.household_id,
        MemoryChunk.source_type == "transaction"))).scalars().all()
    indexed_ids = {r.source_id for r in rows}
    assert counts["transaction"] == 1  # only the missing confirmed txn
    assert missing.id in indexed_ids
    assert draft.id not in indexed_ids  # drafts are never memory


@pytest.mark.asyncio
async def test_run_reindex_returns_all_source_counts(session):
    from app.analyst.service import run_reindex
    from app.models.transactions import Transaction

    user = await _user(session)
    session.add(Transaction(household_id=user.household_id, amount=Decimal("4.00"),
                            currency="USD", txn_date=date(2026, 6, 4), status="confirmed"))
    await session.commit()
    out = await run_reindex(session, user, _FakeLLM())
    assert out == {"transactions": 1, "loans": 0, "recurring": 0}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec api pytest tests/test_m22_w4_ingestion.py -k "reconcile or all_source" -v`
Expected: FAIL — `ModuleNotFoundError: app.analyst.memory.reconcile`.

- [ ] **Step 3: Write the reconcile module**

Create `backend/app/analyst/memory/reconcile.py`:

```python
"""Nightly gap-filling safety net. For each source type, index any row that has
no memory_chunk yet — so memory self-heals even if an on-write enqueue was
dropped. Reuses index_source for rendering; only the missing-id query lives here."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.analyst.memory.ingest import index_source
from app.models.debt import Loan
from app.models.memory import MemoryChunk
from app.models.transactions import RecurringSeries, Transaction

_MODELS = {"transaction": Transaction, "loan": Loan, "recurring": RecurringSeries}


async def _missing_ids(session: AsyncSession, household_id: uuid.UUID, source_type: str) -> list[uuid.UUID]:
    model = _MODELS[source_type]
    indexed = (
        select(MemoryChunk.source_id)
        .where(MemoryChunk.household_id == household_id, MemoryChunk.source_type == source_type)
    )
    stmt = select(model.id).where(model.household_id == household_id, model.id.not_in(indexed))
    if source_type == "transaction":
        stmt = stmt.where(Transaction.status == "confirmed")
    return list((await session.execute(stmt)).scalars().all())


async def reconcile_source(session: AsyncSession, household_id: uuid.UUID, source_type: str, llm) -> int:
    ids = await _missing_ids(session, household_id, source_type)
    if not ids:
        return 0
    return await index_source(session, household_id, source_type, ids, llm)


async def reconcile_household(session: AsyncSession, household_id: uuid.UUID, llm) -> dict[str, int]:
    return {
        source_type: await reconcile_source(session, household_id, source_type, llm)
        for source_type in _MODELS
    }
```

- [ ] **Step 4: Rewrite `run_reindex` to use reconcile**

In `backend/app/analyst/service.py`, replace `run_reindex` (lines 41-43):

```python
async def run_reindex(session, user, llm) -> dict:
    from app.analyst.memory.reconcile import reconcile_household
    counts = await reconcile_household(session, user.household_id, llm)
    return {
        "transactions": counts["transaction"],
        "loans": counts["loan"],
        "recurring": counts["recurring"],
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `docker compose exec api pytest tests/test_m22_w4_ingestion.py -k "reconcile or all_source" -v`
Expected: PASS.

- [ ] **Step 6: Confirm the legacy reindex test still passes**

Run: `docker compose exec api pytest tests/test_m22_memory.py::test_run_reindex_counts_transactions -v`
Expected: PASS (`out["transactions"] == 1` still holds).

- [ ] **Step 7: Add the daily beat task**

In `backend/app/tasks/analyst.py`, add the import:

```python
from app.analyst.memory.reconcile import reconcile_household
from app.models.core import Household
from sqlalchemy import select
```

Append the task:

```python
@celery.task(name="analyst.reindex_daily")
def reindex_daily() -> dict:
    return asyncio.run(_reindex_daily())


async def _reindex_daily() -> dict:
    total = 0
    async with SessionLocal() as session:
        household_ids = list((await session.execute(select(Household.id))).scalars().all())
        for hh in household_ids:
            try:
                llm = await get_household_llm_client(session, hh)
                counts = await reconcile_household(session, hh, llm)
                total += sum(counts.values())
            except Exception:  # one household's failure must not abort the sweep
                continue
    return {"households": len(household_ids), "indexed": total}
```

- [ ] **Step 8: Add the beat schedule entry**

In `backend/app/celery_app.py`, add to `beat_schedule` (after `analyst-scan-alerts-daily`):

```python
        "analyst-reindex-daily": {
            "task": "analyst.reindex_daily",
            "schedule": crontab(hour=4, minute=30),
        },
```

- [ ] **Step 9: Verify the task module imports cleanly**

Run: `docker compose exec api python -c "import app.tasks.analyst, app.celery_app; print('ok')"`
Expected: prints `ok`.

- [ ] **Step 10: Commit**

```bash
git add backend/app/analyst/memory/reconcile.py backend/app/analyst/service.py backend/app/tasks/analyst.py backend/app/celery_app.py backend/tests/test_m22_w4_ingestion.py
git commit -m "feat(analyst): nightly reconcile gap-fills memory across all sources"
```

---

### Task 5: Snapshot enrichment — holdings + income_sources + grounding

**Files:**
- Modify: `backend/app/analyst/schemas.py:108-127` (`FinancialSnapshot`)
- Modify: `backend/app/analyst/snapshot.py`
- Modify: `backend/app/analyst/service.py:132-140` (`_GROUNDING_RULES`)
- Test: `backend/tests/test_m22_w4_ingestion.py`

**Interfaces:**
- Consumes: `widgets.list_holdings(session, user)` → list of dicts with `name`, `symbol`, `asset_type`, `quantity`, `currency`, `latest_valuation` (a `HoldingValuation` or `None`); `income.list_income_sources(session, user)` → list of `IncomeSource` ORM rows with `employer`, `frequency`, `currency`, `gross`, `net`.
- Produces: `FinancialSnapshot.holdings: list[dict]` and `FinancialSnapshot.income_sources: list[dict]`. Since `to_prompt` dumps the whole snapshot JSON, both flow into context automatically.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_m22_w4_ingestion.py`:

```python
def _async(value):
    async def _coro(*a, **k):
        return value
    return _coro()


@pytest.mark.asyncio
async def test_build_snapshot_includes_holdings_and_income(monkeypatch):
    from app.analyst import snapshot as snapshot_mod

    monkeypatch.setattr(snapshot_mod.analytics, "summary", lambda *a, **k: _async({"rows": []}))
    monkeypatch.setattr(snapshot_mod.analytics, "timeseries", lambda *a, **k: _async({"points": []}))
    monkeypatch.setattr(snapshot_mod.analytics, "breakdown", lambda *a, **k: _async({"rows": []}))
    monkeypatch.setattr(snapshot_mod.analytics, "net_worth", lambda *a, **k: _async({"currency": "USD"}))
    monkeypatch.setattr(snapshot_mod.analytics, "list_budgets", lambda *a, **k: _async([]))
    monkeypatch.setattr(snapshot_mod.analytics, "recommendations", lambda *a, **k: _async([]))
    monkeypatch.setattr(snapshot_mod.widgets, "list_recurring", lambda *a, **k: _async([]))
    monkeypatch.setattr(snapshot_mod.widgets, "list_credit_cards", lambda *a, **k: _async([]))
    monkeypatch.setattr(snapshot_mod.loans_service, "list_loans", lambda *a, **k: _async([]))
    monkeypatch.setattr(
        snapshot_mod.widgets, "list_holdings",
        lambda *a, **k: _async([{
            "name": "Acme ETF", "symbol": "ACME", "asset_type": "etf",
            "quantity": Decimal("10"), "currency": "USD",
            "latest_valuation": SimpleNamespace(value=Decimal("1500.00")),
        }]),
    )
    monkeypatch.setattr(
        snapshot_mod.income, "list_income_sources",
        lambda *a, **k: _async([SimpleNamespace(
            employer="Globex", frequency="monthly", currency="USD",
            gross=Decimal("8000.00"), net=Decimal("6000.00"))]),
    )

    snap = await snapshot_mod.build_snapshot(None, SimpleNamespace(id="u"), date(2026, 6, 1), date(2026, 6, 30))
    assert snap.holdings and snap.holdings[0]["name"] == "Acme ETF"
    assert snap.holdings[0]["value"] == 1500.0
    assert snap.income_sources and snap.income_sources[0]["employer"] == "Globex"
    assert snap.income_sources[0]["gross"] == 8000.0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec api pytest tests/test_m22_w4_ingestion.py::test_build_snapshot_includes_holdings_and_income -v`
Expected: FAIL — `AttributeError: module 'app.analyst.snapshot' has no attribute 'income'` (or `FinancialSnapshot` has no `holdings`).

- [ ] **Step 3: Add the schema fields**

In `backend/app/analyst/schemas.py`, inside `FinancialSnapshot` (after `loans`, before `recommendations`):

```python
    holdings: list[dict[str, Any]] = Field(default_factory=list)
    income_sources: list[dict[str, Any]] = Field(default_factory=list)
```

- [ ] **Step 4: Populate them in `build_snapshot`**

In `backend/app/analyst/snapshot.py`, add the income import near the top imports:

```python
from app.income import service as income
```

Inside `build_snapshot`, after the `loan_rows`/`loans` block (line 45) add:

```python
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
```

Then add both to the `FinancialSnapshot(...)` constructor (next to `loans=loans,`):

```python
        holdings=holdings,
        income_sources=income_sources,
```

- [ ] **Step 5: Extend the grounding rules**

In `backend/app/analyst/service.py`, replace the `_GROUNDING_RULES` string (lines 132-140) so the last sentence becomes:

```python
    " If the snapshot and the provided records and facts do not contain the answer, say you don't"
    " have that information rather than guessing."
    " The snapshot's holdings and income_sources arrays list the user's investment holdings and"
    " income sources; when asked about stocks, investments, or income you may list and break them"
    " down from those arrays, but never invent values not present there."
```

- [ ] **Step 6: Run test to verify it passes**

Run: `docker compose exec api pytest tests/test_m22_w4_ingestion.py::test_build_snapshot_includes_holdings_and_income -v`
Expected: PASS.

- [ ] **Step 7: Confirm existing snapshot tests still pass**

Run: `docker compose exec api pytest tests/test_m19_analyst.py -k snapshot -v`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/app/analyst/schemas.py backend/app/analyst/snapshot.py backend/app/analyst/service.py backend/tests/test_m22_w4_ingestion.py
git commit -m "feat(analyst): snapshot carries holdings + income sources"
```

---

### Task 6: Recency-aware retrieval in the assembler

**Files:**
- Modify: `backend/app/analyst/memory/retrieve.py`
- Modify: `backend/app/analyst/memory/assembler.py:25-48` (`assemble`)
- Test: `backend/tests/test_m22_w4_ingestion.py`

**Interfaces:**
- Consumes: `MemoryChunk.meta["date"]` (set by Task 2); `scoped_query`.
- Produces: `async recent_transaction_chunks(session, user, limit: int = 5) -> list[MemoryChunk]` — newest-first by `meta->>'date'`. `assemble(...)` merges these into `ctx.chunks` after the semantic hits, deduped by chunk id, so "recent transactions" always returns actually-recent rows regardless of semantic match.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_m22_w4_ingestion.py`:

```python
@pytest.mark.asyncio
async def test_assemble_always_includes_recent_transactions(session, monkeypatch):
    from app.analyst.memory import assembler as assembler_mod
    from app.analyst.memory.ingest import index_source
    from app.analyst.schemas import FinancialSnapshot
    from app.models.transactions import Transaction

    user = await _user(session)
    old = Transaction(household_id=user.household_id, amount=Decimal("5.00"),
                      currency="USD", txn_date=date(2026, 1, 1), status="confirmed")
    recent = Transaction(household_id=user.household_id, amount=Decimal("6.00"),
                         currency="USD", txn_date=date(2026, 6, 20), status="confirmed")
    session.add_all([old, recent])
    await session.commit()
    await index_source(session, user.household_id, "transaction", [old.id, recent.id], _FakeLLM())

    # Force semantic retrieval to return nothing so only the recency path can supply chunks.
    async def _no_semantic(*a, **k):
        return []

    monkeypatch.setattr(assembler_mod, "retrieve_chunks", _no_semantic)
    monkeypatch.setattr(
        assembler_mod, "build_snapshot",
        lambda *a, **k: _async(FinancialSnapshot(currency="USD", income=0, expenses=0, net=0,
                                                 net_worth=0, assets=0, liabilities=0)),
    )

    ctx = await assembler_mod.assemble(
        session, user, "what are my recent transactions", _FakeLLM(),
        date(2026, 6, 1), date(2026, 6, 30),
    )
    ids = {c["source_id"] for c in ctx.chunks}
    assert str(recent.id) in ids  # newest transaction is always present
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec api pytest tests/test_m22_w4_ingestion.py::test_assemble_always_includes_recent_transactions -v`
Expected: FAIL — `ctx.chunks` is empty (no recency path yet).

- [ ] **Step 3: Add `recent_transaction_chunks` to the retriever**

In `backend/app/analyst/memory/retrieve.py`, append:

```python
async def recent_transaction_chunks(session: AsyncSession, user: User, limit: int = 5) -> list[MemoryChunk]:
    """Newest transaction chunks by their stored source date, independent of any
    semantic match — so 'recent transactions' returns actually-recent rows."""
    date_text = MemoryChunk.meta["date"].astext
    stmt = (
        scoped_query(MemoryChunk, user)
        .where(MemoryChunk.source_type == "transaction", date_text.is_not(None))
        .order_by(date_text.desc())
        .limit(limit)
    )
    return list((await session.execute(stmt)).scalars().all())
```

- [ ] **Step 4: Merge recency into `assemble`**

In `backend/app/analyst/memory/assembler.py`, update the import line:

```python
from app.analyst.memory.retrieve import active_facts, recent_transaction_chunks, retrieve_chunks
```

Then, inside `assemble`, replace the body (lines 36-48) with:

```python
    snapshot = await build_snapshot(session, user, from_date, to_date)
    chunks = await retrieve_chunks(session, user, question, llm, limit=max_chunks)
    recent = await recent_transaction_chunks(session, user, limit=5)
    seen = {c.id for c in chunks}
    merged = list(chunks) + [c for c in recent if c.id not in seen]
    facts = await active_facts(session, user)
    return AssembledContext(
        snapshot=snapshot.model_dump(),
        chunks=[
            {"source_type": c.source_type, "source_id": str(c.source_id), "text": c.text}
            for c in merged
        ],
        facts=[{"domain": f.domain, "text": f.text} for f in facts],
        page=page,
        page_context=page_context,
    )
```

- [ ] **Step 5: Run test to verify it passes**

Run: `docker compose exec api pytest tests/test_m22_w4_ingestion.py::test_assemble_always_includes_recent_transactions -v`
Expected: PASS.

- [ ] **Step 6: Confirm the existing assembler tests still pass**

Run: `docker compose exec api pytest tests/test_m22_memory.py -k assemble -v`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/app/analyst/memory/retrieve.py backend/app/analyst/memory/assembler.py backend/tests/test_m22_w4_ingestion.py
git commit -m "feat(analyst): assembler always includes most-recent transactions"
```

---

### Task 7: `GET /analyst/memory/status` + typed reindex response

**Files:**
- Modify: `backend/app/analyst/schemas.py` (add status + reindex schemas)
- Modify: `backend/app/analyst/service.py` (add `memory_status`)
- Modify: `backend/app/analyst/router.py:77-83` (status route + typed reindex)
- Test: `backend/tests/test_m22_w4_ingestion.py`

**Interfaces:**
- Produces:
  - `MemorySourceStatus(source_type: str, count: int, last_indexed: datetime | None)`
  - `MemoryStatusOut(sources: list[MemorySourceStatus], last_synced: datetime | None)`
  - `ReindexOut(transactions: int, loans: int, recurring: int)`
  - `async memory_status(session, user) -> MemoryStatusOut`
  - `GET /analyst/memory/status` → `MemoryStatusOut`; `POST /analyst/reindex` → `ReindexOut`.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_m22_w4_ingestion.py`:

```python
@pytest.mark.asyncio
async def test_memory_status_counts_per_source(session):
    from app.analyst.memory.ingest import index_source
    from app.analyst.service import memory_status
    from app.models.transactions import Transaction

    user = await _user(session)
    session.add_all([
        Transaction(household_id=user.household_id, amount=Decimal("1.00"), currency="USD",
                    txn_date=date(2026, 6, 1), status="confirmed"),
        Transaction(household_id=user.household_id, amount=Decimal("2.00"), currency="USD",
                    txn_date=date(2026, 6, 2), status="confirmed"),
    ])
    await session.commit()
    txns = (await session.execute(select(Transaction.id).where(
        Transaction.household_id == user.household_id))).scalars().all()
    await index_source(session, user.household_id, "transaction", list(txns), _FakeLLM())

    status = await memory_status(session, user)
    by_type = {s.source_type: s for s in status.sources}
    assert by_type["transaction"].count == 2
    assert by_type["transaction"].last_indexed is not None
    assert status.last_synced is not None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec api pytest tests/test_m22_w4_ingestion.py::test_memory_status_counts_per_source -v`
Expected: FAIL — `cannot import name 'memory_status'`.

- [ ] **Step 3: Add the schemas**

In `backend/app/analyst/schemas.py`, after `FinancialSnapshot` add:

```python
class MemorySourceStatus(BaseModel):
    source_type: str
    count: int
    last_indexed: datetime | None = None


class MemoryStatusOut(BaseModel):
    sources: list[MemorySourceStatus] = Field(default_factory=list)
    last_synced: datetime | None = None


class ReindexOut(BaseModel):
    transactions: int = 0
    loans: int = 0
    recurring: int = 0
```

- [ ] **Step 4: Add `memory_status` to the service**

In `backend/app/analyst/service.py`, add `func` to the sqlalchemy import (`from sqlalchemy import func, select`) and the schema imports `MemoryStatusOut, MemorySourceStatus`, then add:

```python
async def memory_status(session, user) -> MemoryStatusOut:
    from app.models.memory import MemoryChunk
    rows = (await session.execute(
        select(MemoryChunk.source_type, func.count(), func.max(MemoryChunk.created_at))
        .where(MemoryChunk.household_id == user.household_id)
        .group_by(MemoryChunk.source_type)
    )).all()
    sources = [
        MemorySourceStatus(source_type=st, count=count, last_indexed=last)
        for st, count, last in rows
    ]
    last_synced = max((s.last_indexed for s in sources if s.last_indexed), default=None)
    return MemoryStatusOut(sources=sources, last_synced=last_synced)
```

- [ ] **Step 5: Add the route + type the reindex response**

In `backend/app/analyst/router.py`, extend the schema import block to include `MemoryStatusOut, ReindexOut`, then add the status route and annotate reindex:

```python
@router.get("/memory/status", response_model=MemoryStatusOut)
async def memory_status(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await service.memory_status(session, user)


@router.post("/reindex", response_model=ReindexOut)
async def reindex(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    llm: LLMClient = Depends(get_llm_client),
):
    return await service.run_reindex(session, user, llm)
```

(Replace the existing untyped `reindex` route at lines 77-83 with the typed version above.)

- [ ] **Step 6: Run the test + route registration check**

Run: `docker compose exec api pytest tests/test_m22_w4_ingestion.py::test_memory_status_counts_per_source -v`
Expected: PASS.

Run: `docker compose exec api python -c "from app.main import app; paths={r.path for r in app.routes}; assert '/analyst/memory/status' in paths; print('ok')"`
Expected: prints `ok`.

- [ ] **Step 7: Commit**

```bash
git add backend/app/analyst/schemas.py backend/app/analyst/service.py backend/app/analyst/router.py backend/tests/test_m22_w4_ingestion.py
git commit -m "feat(analyst): memory status endpoint + typed reindex response"
```

---

### Task 8: Settings "Memory" card (frontend)

**Files:**
- Regenerate: `shared/api-schema.ts` (via `npm run gen:api`, backend up)
- Modify: `web/lib/api/analyst.ts` (add `useMemoryStatus`, `useReindexMemory`)
- Modify: `web/app/(app)/settings/page.tsx` (render `<MemoryCard />`)
- Test: `web/app/(app)/settings/__tests__/memory-card.test.tsx` (create)

**Interfaces:**
- Consumes: `GET /analyst/memory/status` → `MemoryStatusOut`; `POST /analyst/reindex` → `ReindexOut` (Task 7).
- Produces: `useMemoryStatus()` (TanStack query, key `["analyst","memory","status"]`); `useReindexMemory()` (mutation that invalidates the status query); a `MemoryCard` component showing per-source coverage + last-synced + a "Re-sync now" button.

- [ ] **Step 1: Regenerate the API schema**

With the backend running on `:8000`:

Run: `cd web && npm run gen:api`
Expected: `shared/api-schema.ts` now contains `MemoryStatusOut`, `MemorySourceStatus`, and `ReindexOut` under `components["schemas"]`.

Verify: `grep -c "MemoryStatusOut" ../shared/api-schema.ts` → at least `1`.

- [ ] **Step 2: Write the failing component test**

Create `web/app/(app)/settings/__tests__/memory-card.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { MemoryCard } from "../memory-card";

vi.mock("@/lib/api/analyst", () => ({
  useMemoryStatus: () => ({
    isLoading: false,
    data: {
      sources: [
        { source_type: "transaction", count: 1240, last_indexed: "2026-06-25T10:00:00Z" },
        { source_type: "loan", count: 4, last_indexed: "2026-06-25T09:00:00Z" },
      ],
      last_synced: "2026-06-25T10:00:00Z",
    },
  }),
  useReindexMemory: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient();
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

describe("MemoryCard", () => {
  it("renders per-source coverage and a re-sync button", async () => {
    render(wrap(<MemoryCard />));
    await waitFor(() => {
      expect(screen.getByText(/1,240 transactions/i)).toBeInTheDocument();
      expect(screen.getByText(/4 loans/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /re-sync now/i })).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd web && npx vitest run "app/(app)/settings/__tests__/memory-card.test.tsx"`
Expected: FAIL — cannot resolve `../memory-card`.

- [ ] **Step 4: Add the hooks**

Append to `web/lib/api/analyst.ts`:

```ts
export type MemoryStatus = components["schemas"]["MemoryStatusOut"];

export function useMemoryStatus() {
  return useQuery<MemoryStatus>({
    queryKey: ["analyst", "memory", "status"],
    queryFn: () => unwrap(api.GET("/analyst/memory/status", {})),
  });
}

export function useReindexMemory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(api.POST("/analyst/reindex", {})),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["analyst", "memory", "status"] }),
  });
}
```

- [ ] **Step 5: Create the card component**

Create `web/app/(app)/settings/memory-card.tsx`:

```tsx
"use client";

import { toast } from "sonner";

import { useMemoryStatus, useReindexMemory } from "@/lib/api/analyst";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const LABELS: Record<string, string> = {
  transaction: "transactions",
  loan: "loans",
  recurring: "recurring items",
  document: "documents",
  note: "notes",
};

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function MemoryCard() {
  const status = useMemoryStatus();
  const reindex = useReindexMemory();

  const coverage = (status.data?.sources ?? [])
    .filter((s) => s.count > 0)
    .map((s) => `${s.count.toLocaleString()} ${LABELS[s.source_type] ?? s.source_type}`)
    .join(", ");

  async function resync() {
    try {
      await reindex.mutateAsync();
      toast.success("Memory re-synced");
    } catch {
      toast.error("Couldn't re-sync memory");
    }
  }

  return (
    <div className="rounded-card-sm border border-border bg-card p-4 shadow-card">
      <div className="mb-3">
        <h2 className="text-base font-bold tracking-tight">Memory</h2>
        <p className="text-sm text-muted">What the analyst has indexed and can recall.</p>
      </div>
      {status.isLoading ? (
        <Skeleton className="h-10" />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">
            {coverage || "Nothing indexed yet."}
            {status.data?.last_synced && (
              <span className="text-muted"> · last synced {timeAgo(status.data.last_synced)}</span>
            )}
          </p>
          <Button variant="outline" onClick={resync} disabled={reindex.isPending}>
            {reindex.isPending ? "Syncing…" : "Re-sync now"}
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Mount the card in Settings**

In `web/app/(app)/settings/page.tsx`, add the import near the other component imports:

```tsx
import { MemoryCard } from "./memory-card";
```

Then add `<MemoryCard />` to the page body, after `<ConsentsCard />`:

```tsx
      <ConsentsCard />
      <MemoryCard />
      <DataControlsCard />
```

- [ ] **Step 7: Run the component test**

Run: `cd web && npx vitest run "app/(app)/settings/__tests__/memory-card.test.tsx"`
Expected: PASS.

- [ ] **Step 8: Typecheck the web app**

Run: `cd web && npm run typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add shared/api-schema.ts "web/lib/api/analyst.ts" "web/app/(app)/settings/page.tsx" "web/app/(app)/settings/memory-card.tsx" "web/app/(app)/settings/__tests__/memory-card.test.tsx"
git commit -m "feat(analyst): Settings Memory card shows coverage + re-sync"
```

---

### Task 9: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Backend — full analyst + memory suites**

Run: `docker compose exec api pytest tests/test_m22_w4_ingestion.py tests/test_m22_memory.py tests/test_m19_analyst.py -v`
Expected: all PASS.

- [ ] **Step 2: Web — full unit suite + typecheck**

Run: `cd web && npx vitest run && npm run typecheck`
Expected: all PASS, no type errors.

- [ ] **Step 3: Commit (only if any verification fix was needed)**

```bash
git add -A
git commit -m "test(analyst): W4 ingestion full-suite green"
```

---

## Self-Review

**Spec coverage:**
- A (incremental ingestion on write) → Tasks 2 + 3 (`index_source` + Celery task + 3 write paths wired). ✅
- B (daily reconciliation safety net, gap-filling, beat entry) → Task 4. ✅
- C (snapshot stocks + income + grounding) → Task 5. ✅
- D (recency-aware retrieval via `meta` date + always-recent transactions) → Tasks 1 + 6. ✅
- E (memory status endpoint, extended reindex, frontend hooks + card) → Tasks 7 + 8. ✅
- F (testing: snapshot holdings/income, recency newest, incremental indexes confirmed txn, reconcile fills gaps, status endpoint; web vitest + typecheck) → covered across Tasks 1–8 and verified in Task 9. ✅
- "No DB migration" / "out of scope: new source types" → honored: `meta` + enum values pre-exist; holdings/income live only in the snapshot, never as chunks. ✅

**Type consistency:** `index_source(session, household_id, source_type, source_ids, llm)` and `enqueue_index_source(household_id, source_type, source_ids)` are used identically in Tasks 2/3/4. `reconcile_household(...) -> {"transaction"|"loan"|"recurring": int}` keys match `run_reindex`'s remap in Task 4. `MemoryStatusOut`/`ReindexOut` names match between schema (Task 7), router (Task 7), and frontend (Task 8). `recent_transaction_chunks` is named identically in retrieve.py and the assembler import (Task 6).

**Placeholder scan:** no TBD/TODO/"handle edge cases"; every code step carries full code and an exact command with expected output.
