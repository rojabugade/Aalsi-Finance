# Analyst Memory & Awareness — Wave 1 (Memory Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the analyst long-term memory — embed every transaction/loan/recurring row and every uploaded document into a unified `memory_chunk` store, extract durable `memory_fact`s from documents, and feed semantically-retrieved memory + learned facts into `run_ask` with citations and an "I don't have that" guardrail.

**Architecture:** A new `app/analyst/memory/` package owns a unified pgvector index (`memory_chunk`) plus a learned-facts table (`memory_fact`). An indexer renders each source row to a short sentence and embeds it; a retriever does an L2-distance vector search (mirroring the existing M10 guidance RAG); a Context Assembler merges the existing `FinancialSnapshot` with retrieved chunks, active facts, and page scope into a token-budgeted block that `run_ask` sends to the LLM.

**Tech Stack:** FastAPI, SQLAlchemy (async), pgvector (`Vector(embed_dim)`, `.l2_distance`), Alembic, the M3 `LLMClient.embed()` / `.chat()` gateway, pytest + pytest-asyncio.

## Global Constraints

- All new tables include `household_id` and are queried via `app.auth.deps.scoped_query` for tenant isolation — copy the pattern from `app/guidance/service.py`. (verbatim: tenant isolation is mandatory)
- Embedding dimension MUST come from `get_settings().embed_dim` (default `1536`) via a module-level `_EMBED_DIM`, exactly like `app/models/guidance.py`. Never hardcode `1536`.
- Enum-like columns use `str_enum("name", "a", "b")` (VARCHAR + CHECK), never native PG enums — per `app/models/base.py`.
- The analyst is **optional**: any LLM/embedding failure must degrade gracefully (return partial/empty memory), never raise a 5xx — match the existing `except LLMError` / bare `except Exception` handling in `app/analyst/service.py::run_ask`.
- Money is `NUMERIC(18,2)`; currency is a 3-letter ISO string.
- Tests connect to `TEST_DATABASE_URL` (default `postgresql+asyncpg://finance:finance@localhost:5433/finance`) and `pytest.skip` when Postgres is unreachable — copy the `engine`/`session` fixtures from `tests/test_m10_guidance.py`. DB-backed tests must clean up by a `pytest-m22-` prefix.
- New migration's `down_revision` is the current head `c7e3b9d1f4a8`.
- Run backend tests in the api container (local `.venv` is x86_64/broken): `docker compose exec api pytest tests/test_m22_memory.py -v`. If the container image is stale, `docker compose build api` first.

---

### Task 1: Memory models + Document columns + migration

**Files:**
- Create: `backend/app/models/memory.py`
- Modify: `backend/app/models/documents.py` (add `domain`, `private`, `extracted_text`)
- Create: `backend/migrations/versions/d1a2b3c4e5f6_m22_analyst_memory.py`
- Test: `backend/tests/test_m22_memory.py`

**Interfaces:**
- Produces: `MemoryChunk(id, household_id, source_type, source_id, text, embedding, meta, created_at)`; `MemoryFact(id, household_id, domain, text, structured, confidence, sensitive, source_refs, status, embedding, created_at, updated_at)`; `Document.domain`, `Document.private`, `Document.extracted_text`.
- `MemoryChunk.source_type` ∈ {`document`,`transaction`,`loan`,`recurring`,`note`}; `MemoryFact.domain` ∈ {`finance`,`health`,`lifestyle`,`goal`}; `MemoryFact.status` ∈ {`active`,`superseded`}.

- [ ] **Step 1: Write the model file**

```python
# backend/app/models/memory.py
"""Analyst long-term memory: a unified pgvector chunk index plus durable
learned facts. Embedding dim is driven by settings.embed_dim (M3) and MUST
match the guidance_doc embedding dim — see app/models/guidance.py."""

from __future__ import annotations

import uuid
from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import Boolean, DateTime, Float, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.config import get_settings
from app.models.base import Base, TimestampMixin, fk_uuid, str_enum, uuid_pk

_EMBED_DIM = get_settings().embed_dim


class MemoryChunk(Base):
    __tablename__ = "memory_chunk"

    id: Mapped[uuid.UUID] = uuid_pk()
    household_id: Mapped[uuid.UUID] = fk_uuid(
        ForeignKey("household.id", ondelete="CASCADE"), index=True, nullable=False
    )
    source_type: Mapped[str] = mapped_column(
        str_enum("memory_source_type", "document", "transaction", "loan", "recurring", "note"),
        nullable=False,
    )
    source_id: Mapped[uuid.UUID | None] = fk_uuid(nullable=True, index=True)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    embedding: Mapped[list[float] | None] = mapped_column(Vector(_EMBED_DIM))
    meta: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class MemoryFact(Base, TimestampMixin):
    __tablename__ = "memory_fact"

    id: Mapped[uuid.UUID] = uuid_pk()
    household_id: Mapped[uuid.UUID] = fk_uuid(
        ForeignKey("household.id", ondelete="CASCADE"), index=True, nullable=False
    )
    domain: Mapped[str] = mapped_column(
        str_enum("memory_fact_domain", "finance", "health", "lifestyle", "goal"), nullable=False
    )
    text: Mapped[str] = mapped_column(Text, nullable=False)
    structured: Mapped[dict | None] = mapped_column(JSONB)
    confidence: Mapped[float | None] = mapped_column(Float)
    sensitive: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    source_refs: Mapped[dict | None] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(
        str_enum("memory_fact_status", "active", "superseded"), nullable=False, default="active"
    )
    embedding: Mapped[list[float] | None] = mapped_column(Vector(_EMBED_DIM))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
```

- [ ] **Step 2: Add columns to the Document model**

In `backend/app/models/documents.py`, inside `class Document`, after the `ocr_meta` column add:

```python
    domain: Mapped[str | None] = mapped_column(
        str_enum("document_domain", "finance", "health", "lifestyle", "other")
    )
    private: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    extracted_text: Mapped[str | None] = mapped_column(Text)
```

Add `Boolean`, `Text` to the `from sqlalchemy import ...` line and `str_enum` is already imported from `app.models.base`.

- [ ] **Step 3: Register the new module so metadata sees the tables**

In `backend/app/models/__init__.py`, add `from app.models import memory  # noqa: F401` alongside the other model imports (match the existing import style in that file).

- [ ] **Step 4: Write the Alembic migration**

```python
# backend/migrations/versions/d1a2b3c4e5f6_m22_analyst_memory.py
"""m22 analyst memory: memory_chunk, memory_fact, document memory columns

Revision ID: d1a2b3c4e5f6
Revises: c7e3b9d1f4a8
"""
from __future__ import annotations

from typing import Union

import pgvector.sqlalchemy
import sqlalchemy as sa
from alembic import op

revision: str = "d1a2b3c4e5f6"
down_revision: Union[str, None] = "c7e3b9d1f4a8"
branch_labels = None
depends_on = None

_DIM = 1536  # matches settings.embed_dim default; guidance_doc uses the same


def upgrade() -> None:
    op.create_table(
        "memory_chunk",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("household_id", sa.dialects.postgresql.UUID(as_uuid=True), sa.ForeignKey("household.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("source_type", sa.String(), nullable=False),
        sa.Column("source_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True, index=True),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("embedding", pgvector.sqlalchemy.Vector(_DIM), nullable=True),
        sa.Column("meta", sa.dialects.postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("source_type IN ('document','transaction','loan','recurring','note')", name="ck_memory_chunk_source_type"),
    )
    op.create_table(
        "memory_fact",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("household_id", sa.dialects.postgresql.UUID(as_uuid=True), sa.ForeignKey("household.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("domain", sa.String(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("structured", sa.dialects.postgresql.JSONB(), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=True),
        sa.Column("sensitive", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("source_refs", sa.dialects.postgresql.JSONB(), nullable=True),
        sa.Column("status", sa.String(), nullable=False, server_default="active"),
        sa.Column("embedding", pgvector.sqlalchemy.Vector(_DIM), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("domain IN ('finance','health','lifestyle','goal')", name="ck_memory_fact_domain"),
        sa.CheckConstraint("status IN ('active','superseded')", name="ck_memory_fact_status"),
    )
    op.add_column("document", sa.Column("domain", sa.String(), nullable=True))
    op.add_column("document", sa.Column("private", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("document", sa.Column("extracted_text", sa.Text(), nullable=True))
    op.create_check_constraint("ck_document_domain", "document", "domain IS NULL OR domain IN ('finance','health','lifestyle','other')")


def downgrade() -> None:
    op.drop_constraint("ck_document_domain", "document", type_="check")
    op.drop_column("document", "extracted_text")
    op.drop_column("document", "private")
    op.drop_column("document", "domain")
    op.drop_table("memory_fact")
    op.drop_table("memory_chunk")
```

- [ ] **Step 5: Apply the migration**

Run: `docker compose exec api alembic upgrade head`
Expected: `Running upgrade c7e3b9d1f4a8 -> d1a2b3c4e5f6, m22 analyst memory`

- [ ] **Step 6: Write the failing schema test**

```python
# backend/tests/test_m22_memory.py
from __future__ import annotations

import os
import uuid

import pytest
import pytest_asyncio
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models.core import Household, User
from app.models.memory import MemoryChunk, MemoryFact

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL", "postgresql+asyncpg://finance:finance@localhost:5433/finance")
PREFIX = "pytest-m22-"


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
async def test_memory_chunk_and_fact_round_trip(session):
    user = await _user(session)
    session.add(MemoryChunk(household_id=user.household_id, source_type="transaction",
                            source_id=uuid.uuid4(), text="spent 12 USD at Cafe", meta={"amount": 12}))
    session.add(MemoryFact(household_id=user.household_id, domain="health",
                           text="allergic to peanuts", structured={"allergen": "peanut"},
                           sensitive=True, source_refs={"document_id": str(uuid.uuid4())}))
    await session.commit()
    chunks = (await session.execute(select(MemoryChunk).where(MemoryChunk.household_id == user.household_id))).scalars().all()
    facts = (await session.execute(select(MemoryFact).where(MemoryFact.household_id == user.household_id))).scalars().all()
    assert chunks[0].source_type == "transaction"
    assert facts[0].domain == "health" and facts[0].sensitive is True
    assert facts[0].status == "active"
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `docker compose exec api pytest tests/test_m22_memory.py::test_memory_chunk_and_fact_round_trip -v`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add backend/app/models/memory.py backend/app/models/documents.py backend/app/models/__init__.py backend/migrations/versions/d1a2b3c4e5f6_m22_analyst_memory.py backend/tests/test_m22_memory.py
git commit -m "feat(analyst): memory_chunk + memory_fact tables and document memory columns"
```

---

### Task 2: Chunk text rendering (pure functions)

**Files:**
- Create: `backend/app/analyst/memory/__init__.py` (empty)
- Create: `backend/app/analyst/memory/render.py`
- Test: `backend/tests/test_m22_memory.py` (append)

**Interfaces:**
- Produces: `render_transaction(txn) -> str`, `render_loan(loan) -> str`, `render_recurring(series) -> str`, `chunk_text(text, max_chars=800) -> list[str]`. Each `render_*` takes the ORM row and returns one short natural-language sentence; `chunk_text` splits long document text on paragraph boundaries into ≤`max_chars` pieces.

- [ ] **Step 1: Write the failing test (append to test_m22_memory.py)**

```python
from types import SimpleNamespace
from datetime import date
from decimal import Decimal
from app.analyst.memory.render import render_transaction, chunk_text


def test_render_transaction_is_one_grounded_sentence():
    txn = SimpleNamespace(txn_date=date(2026, 6, 1), amount=Decimal("12.50"),
                          currency="USD", name="Blue Bottle Coffee", notes=None)
    out = render_transaction(txn, merchant="Blue Bottle", category="Dining")
    assert "2026-06-01" in out and "12.50" in out and "USD" in out
    assert "Blue Bottle" in out and "Dining" in out


def test_chunk_text_splits_long_text_under_limit():
    parts = chunk_text("para one.\n\n" + ("x" * 900) + "\n\nlast.", max_chars=800)
    assert len(parts) >= 2 and all(len(p) <= 800 for p in parts)
```

- [ ] **Step 2: Run to verify failure**

Run: `docker compose exec api pytest tests/test_m22_memory.py -k render -v`
Expected: FAIL with `ModuleNotFoundError: app.analyst.memory.render`

- [ ] **Step 3: Implement the renderers**

```python
# backend/app/analyst/memory/render.py
"""Render structured rows to short, grounded sentences for embedding, and
split long document text into embeddable chunks."""

from __future__ import annotations


def _money(amount, currency) -> str:
    try:
        return f"{float(amount):.2f} {currency or ''}".strip()
    except (TypeError, ValueError):
        return f"{amount} {currency or ''}".strip()


def render_transaction(txn, *, merchant: str | None = None, category: str | None = None) -> str:
    where = merchant or getattr(txn, "name", None) or "an unknown payee"
    cat = f" ({category})" if category else ""
    note = f" Note: {txn.notes}" if getattr(txn, "notes", None) else ""
    return f"On {txn.txn_date}, spent {_money(txn.amount, txn.currency)} at {where}{cat}.{note}"


def render_loan(loan) -> str:
    rate = "" if getattr(loan, "interest_rate", None) is None else f" at {float(loan.interest_rate):.2f}% APR"
    return (f"Loan '{getattr(loan, 'name', 'loan')}' ({getattr(loan, 'type', 'loan')}), "
            f"principal {_money(getattr(loan, 'principal', 0), getattr(loan, 'currency', ''))}{rate}.")


def render_recurring(series) -> str:
    return (f"Recurring '{getattr(series, 'name', 'item')}' "
            f"{_money(getattr(series, 'amount', 0), getattr(series, 'currency', ''))} "
            f"per {getattr(series, 'cadence', 'period')}.")


def chunk_text(text: str, max_chars: int = 800) -> list[str]:
    paras = [p.strip() for p in (text or "").split("\n\n") if p.strip()]
    chunks: list[str] = []
    for para in paras:
        if len(para) <= max_chars:
            chunks.append(para)
        else:
            for i in range(0, len(para), max_chars):
                chunks.append(para[i : i + max_chars])
    return chunks
```

- [ ] **Step 4: Run to verify pass**

Run: `docker compose exec api pytest tests/test_m22_memory.py -k "render or chunk" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/analyst/memory/__init__.py backend/app/analyst/memory/render.py backend/tests/test_m22_memory.py
git commit -m "feat(analyst): grounded text renderers for memory chunks"
```

---

### Task 3: Indexer — embed and upsert chunks

**Files:**
- Create: `backend/app/analyst/memory/indexer.py`
- Test: `backend/tests/test_m22_memory.py` (append)

**Interfaces:**
- Consumes: `MemoryChunk` model (Task 1); renderers (Task 2); `llm.embed(texts, ...) -> list[list[float]]` (M3).
- Produces: `async index_chunks(session, household_id, source_type, items, llm) -> int` where `items: list[tuple[uuid.UUID, str]]` is `(source_id, text)`. It deletes existing chunks for those `(source_type, source_id)` pairs, embeds the texts (best-effort: on `LLMError` it stores chunks with `embedding=None`), inserts new rows, and returns the count inserted.

- [ ] **Step 1: Write the failing test (append)**

```python
from app.analyst.memory.indexer import index_chunks


class _FakeLLM:
    """Deterministic embeddings of the configured dim for tests."""
    def __init__(self):
        from app.config import get_settings
        self.dim = get_settings().embed_dim
    async def embed(self, texts, **kw):
        items = [texts] if isinstance(texts, str) else list(texts)
        return [[float(len(t) % 7)] + [0.0] * (self.dim - 1) for t in items]


@pytest.mark.asyncio
async def test_index_chunks_is_idempotent_per_source(session):
    user = await _user(session)
    sid = uuid.uuid4()
    n1 = await index_chunks(session, user.household_id, "transaction", [(sid, "spent 5 USD")], _FakeLLM())
    n2 = await index_chunks(session, user.household_id, "transaction", [(sid, "spent 5 USD updated")], _FakeLLM())
    rows = (await session.execute(select(MemoryChunk).where(MemoryChunk.source_id == sid))).scalars().all()
    assert n1 == 1 and n2 == 1
    assert len(rows) == 1 and rows[0].text == "spent 5 USD updated"
    assert rows[0].embedding is not None
```

- [ ] **Step 2: Run to verify failure**

Run: `docker compose exec api pytest tests/test_m22_memory.py -k index_chunks -v`
Expected: FAIL with `ModuleNotFoundError: app.analyst.memory.indexer`

- [ ] **Step 3: Implement the indexer**

```python
# backend/app/analyst/memory/indexer.py
"""Embed rendered source text and upsert it into memory_chunk. Idempotent per
(source_type, source_id): re-indexing a row replaces its prior chunks."""

from __future__ import annotations

import uuid

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.analyst.memory import render
from app.llm.errors import LLMError
from app.models.memory import MemoryChunk


async def index_chunks(
    session: AsyncSession, household_id: uuid.UUID, source_type: str,
    items: list[tuple[uuid.UUID, str]], llm,
) -> int:
    if not items:
        return 0
    source_ids = [sid for sid, _ in items]
    await session.execute(
        delete(MemoryChunk).where(
            MemoryChunk.household_id == household_id,
            MemoryChunk.source_type == source_type,
            MemoryChunk.source_id.in_(source_ids),
        )
    )
    texts = [t for _, t in items]
    try:
        vectors = await llm.embed(texts, purpose="analyst.index", session=session)
    except LLMError:
        vectors = [None] * len(texts)  # store unembedded; a later reindex fills them
    for (sid, txt), vec in zip(items, vectors):
        session.add(MemoryChunk(household_id=household_id, source_type=source_type,
                                source_id=sid, text=txt, embedding=vec))
    await session.commit()
    return len(items)
```

(`render` is imported so callers can `from app.analyst.memory.indexer import index_chunks` and the package resolves; the renderers are used by Task 5's ingestion hook.)

- [ ] **Step 4: Run to verify pass**

Run: `docker compose exec api pytest tests/test_m22_memory.py -k index_chunks -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/analyst/memory/indexer.py backend/tests/test_m22_memory.py
git commit -m "feat(analyst): idempotent chunk indexer with graceful embed fallback"
```

---

### Task 4: Retriever — vector search over chunks + active facts

**Files:**
- Create: `backend/app/analyst/memory/retrieve.py`
- Test: `backend/tests/test_m22_memory.py` (append)

**Interfaces:**
- Consumes: `MemoryChunk`, `MemoryFact` (Task 1); `_FakeLLM`/real `llm.embed`; `scoped_query`.
- Produces: `async retrieve_chunks(session, user, query, llm, limit=8) -> list[MemoryChunk]` (L2-distance nearest, household-scoped, `embedding IS NOT NULL`); `async active_facts(session, user, limit=20) -> list[MemoryFact]` (`status='active'`, household-scoped). On embed failure `retrieve_chunks` returns `[]`.

- [ ] **Step 1: Write the failing test (append)**

```python
from app.analyst.memory.retrieve import retrieve_chunks, active_facts


@pytest.mark.asyncio
async def test_retrieve_orders_by_vector_distance(session):
    user = await _user(session)
    llm = _FakeLLM()
    # text "aaa" -> embed[0] = 3 % 7 = 3 ; "aaaaaa" -> 6 ; query below embeds to 3
    await index_chunks(session, user.household_id, "note", [(uuid.uuid4(), "aaa")], llm)
    await index_chunks(session, user.household_id, "note", [(uuid.uuid4(), "aaaaaa")], llm)
    hits = await retrieve_chunks(session, user, "aaa", llm, limit=1)
    assert len(hits) == 1 and hits[0].text == "aaa"


@pytest.mark.asyncio
async def test_active_facts_excludes_superseded(session):
    user = await _user(session)
    session.add(MemoryFact(household_id=user.household_id, domain="goal", text="save for house", status="active"))
    session.add(MemoryFact(household_id=user.household_id, domain="goal", text="old goal", status="superseded"))
    await session.commit()
    facts = await active_facts(session, user)
    assert [f.text for f in facts] == ["save for house"]
```

- [ ] **Step 2: Run to verify failure**

Run: `docker compose exec api pytest tests/test_m22_memory.py -k "retrieve or active_facts" -v`
Expected: FAIL with `ModuleNotFoundError: app.analyst.memory.retrieve`

- [ ] **Step 3: Implement the retriever**

```python
# backend/app/analyst/memory/retrieve.py
"""Semantic retrieval over memory_chunk (L2 distance, mirroring M10 guidance)
plus the active learned facts for a household."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import scoped_query
from app.llm.errors import LLMError
from app.models.core import User
from app.models.memory import MemoryChunk, MemoryFact


async def retrieve_chunks(session: AsyncSession, user: User, query: str, llm, limit: int = 8) -> list[MemoryChunk]:
    try:
        query_vec = (await llm.embed(query, purpose="analyst.retrieve", user_id=user.id, session=session))[0]
    except (LLMError, IndexError, Exception):  # retrieval is best-effort
        return []
    stmt = (
        scoped_query(MemoryChunk, user)
        .where(MemoryChunk.embedding.is_not(None))
        .order_by(MemoryChunk.embedding.l2_distance(query_vec))
        .limit(limit)
    )
    return list((await session.execute(stmt)).scalars().all())


async def active_facts(session: AsyncSession, user: User, limit: int = 20) -> list[MemoryFact]:
    stmt = (
        scoped_query(MemoryFact, user)
        .where(MemoryFact.status == "active")
        .order_by(MemoryFact.updated_at.desc())
        .limit(limit)
    )
    return list((await session.execute(stmt)).scalars().all())
```

- [ ] **Step 4: Run to verify pass**

Run: `docker compose exec api pytest tests/test_m22_memory.py -k "retrieve or active_facts" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/analyst/memory/retrieve.py backend/tests/test_m22_memory.py
git commit -m "feat(analyst): semantic chunk retrieval + active-facts query"
```

---

### Task 5: Document fact extraction + ingestion hook

**Files:**
- Create: `backend/app/analyst/memory/facts.py`
- Modify: `backend/app/documents/processing.py` (add `index_document_memory`)
- Test: `backend/tests/test_m22_memory.py` (append)

**Interfaces:**
- Consumes: `chunk_text` (Task 2); `index_chunks` (Task 3); `MemoryFact` (Task 1); `llm.chat(..., json_schema=...)` (M3).
- Produces: `async extract_facts(session, user, document, llm) -> list[MemoryFact]` (LLM classifies domain + pulls facts from `document.extracted_text`; persists `active` facts with `source_refs={"document_id": str(document.id)}`; sets `sensitive=True` for `domain="health"`); `async index_document_memory(session, user, document, llm) -> None` (skips when `document.private` is true; otherwise chunks `extracted_text`, calls `index_chunks(..., "document", ...)`, then `extract_facts`). On LLM failure both degrade to no-ops.

- [ ] **Step 1: Write the failing test (append)**

```python
from app.analyst.memory.facts import extract_facts, ExtractedFacts
from app.models.documents import Document


class _FactLLM(_FakeLLM):
    async def chat(self, messages, **kw):
        return {"domain": "health", "facts": [{"text": "allergic to peanuts",
                "structured": {"allergen": "peanut"}, "confidence": 0.9}]}


@pytest.mark.asyncio
async def test_extract_facts_flags_health_sensitive(session):
    user = await _user(session)
    doc = Document(household_id=user.household_id, storage_key="k", type="other",
                   source_channel="upload", status="processed",
                   extracted_text="Patient is allergic to peanuts.")
    session.add(doc)
    await session.commit()
    facts = await extract_facts(session, user, doc, _FactLLM())
    assert facts[0].domain == "health" and facts[0].sensitive is True
    assert facts[0].source_refs["document_id"] == str(doc.id)
```

- [ ] **Step 2: Run to verify failure**

Run: `docker compose exec api pytest tests/test_m22_memory.py -k extract_facts -v`
Expected: FAIL with `ModuleNotFoundError: app.analyst.memory.facts`

- [ ] **Step 3: Implement fact extraction + ingestion hook**

```python
# backend/app/analyst/memory/facts.py
"""LLM extraction of durable facts (allergies, income shape, goals) from a
document's text, plus the per-document indexing entry point."""

from __future__ import annotations

from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.analyst.memory import render
from app.analyst.memory.indexer import index_chunks
from app.llm.errors import LLMError
from app.models.core import User
from app.models.documents import Document
from app.models.memory import MemoryFact

_DOMAINS = {"finance", "health", "lifestyle", "goal"}


class _Fact(BaseModel):
    text: str
    structured: dict | None = None
    confidence: float | None = None


class ExtractedFacts(BaseModel):
    domain: str
    facts: list[_Fact]


_SYSTEM = (
    "You read a user's uploaded document and extract durable, reusable facts about "
    "them (allergies, medical conditions, income shape, financial goals, dietary "
    "preferences). Classify the document's primary domain as one of finance, health, "
    "lifestyle, goal. Return only facts clearly supported by the text; never invent."
)


async def extract_facts(session: AsyncSession, user: User, document: Document, llm) -> list[MemoryFact]:
    text = (document.extracted_text or "").strip()
    if not text:
        return []
    try:
        result = await llm.chat(
            [{"role": "system", "content": _SYSTEM},
             {"role": "user", "content": f"Document text:\n{text}"}],
            json_schema=ExtractedFacts, purpose="analyst.extract_facts",
            user_id=user.id, session=session,
        )
        parsed = ExtractedFacts(**result)
    except (LLMError, Exception):  # extraction is best-effort
        return []
    domain = parsed.domain if parsed.domain in _DOMAINS else "lifestyle"
    out: list[MemoryFact] = []
    for f in parsed.facts:
        fact = MemoryFact(
            household_id=user.household_id, domain=domain, text=f.text,
            structured=f.structured, confidence=f.confidence,
            sensitive=(domain == "health"), status="active",
            source_refs={"document_id": str(document.id)},
        )
        session.add(fact)
        out.append(fact)
    if document.domain is None:
        document.domain = domain if domain in {"finance", "health", "lifestyle"} else "other"
    await session.commit()
    return out


async def index_document_memory(session: AsyncSession, user: User, document: Document, llm) -> None:
    if document.private:
        return
    text = (document.extracted_text or "").strip()
    if text:
        chunks = render.chunk_text(text)
        await index_chunks(session, user.household_id, "document",
                           [(document.id, c) for c in chunks], llm)
    await extract_facts(session, user, document, llm)
```

- [ ] **Step 4: Wire the hook into the processing pipeline**

In `backend/app/documents/processing.py`, after the step that sets a document's `status` to `processed` and populates `extracted_text`, call the memory indexer. Add at the top: `from app.analyst.memory.facts import index_document_memory`. After processing completes for a document with text, within the existing async flow that has `session`, `user`, `document`, and an `llm` client in scope, add:

```python
    try:
        await index_document_memory(session, user, document, llm)
    except Exception:  # memory indexing must never fail document processing
        pass
```

If `processing.py` has no `llm`/`user` in scope at that point, thread them through from the caller in `app/documents/router.py` (the upload/process endpoint already has `get_current_user`; add `llm: LLMClient = Depends(get_llm_client)` and pass both down). Keep the call wrapped so a memory failure never breaks ingestion.

- [ ] **Step 5: Run to verify pass**

Run: `docker compose exec api pytest tests/test_m22_memory.py -k extract_facts -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/analyst/memory/facts.py backend/app/documents/processing.py backend/app/documents/router.py backend/tests/test_m22_memory.py
git commit -m "feat(analyst): extract facts from documents and index them on ingestion"
```

---

### Task 6: Backfill indexer for existing transactions/loans/recurring

**Files:**
- Create: `backend/app/analyst/memory/backfill.py`
- Test: `backend/tests/test_m22_memory.py` (append)

**Interfaces:**
- Consumes: renderers (Task 2); `index_chunks` (Task 3); `scoped_query`.
- Produces: `async backfill_transactions(session, user, llm, limit=500) -> int` (renders confirmed transactions via `render_transaction`, resolving merchant/category names, and indexes them as `source_type="transaction"`; returns count). This is the entry point a future Celery task and the manual reindex endpoint call.

- [ ] **Step 1: Write the failing test (append)**

```python
from app.analyst.memory.backfill import backfill_transactions
from app.models.transactions import Transaction


@pytest.mark.asyncio
async def test_backfill_indexes_transactions(session):
    user = await _user(session)
    session.add(Transaction(household_id=user.household_id, amount=Decimal("9.99"),
                            currency="USD", txn_date=date(2026, 6, 2), name="Cafe", status="confirmed"))
    await session.commit()
    n = await backfill_transactions(session, user, _FakeLLM())
    rows = (await session.execute(select(MemoryChunk).where(
        MemoryChunk.household_id == user.household_id,
        MemoryChunk.source_type == "transaction"))).scalars().all()
    assert n == 1 and len(rows) == 1 and "9.99" in rows[0].text
```

- [ ] **Step 2: Run to verify failure**

Run: `docker compose exec api pytest tests/test_m22_memory.py -k backfill -v`
Expected: FAIL with `ModuleNotFoundError: app.analyst.memory.backfill`

- [ ] **Step 3: Implement the backfill**

```python
# backend/app/analyst/memory/backfill.py
"""Render and index existing structured rows (transactions to start) into
memory_chunk. Entry point for manual reindex and the scheduled job (W2)."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.analyst.memory import render
from app.analyst.memory.indexer import index_chunks
from app.auth.deps import scoped_query
from app.models.core import User
from app.models.transactions import Category, Merchant, Transaction


async def backfill_transactions(session: AsyncSession, user: User, llm, limit: int = 500) -> int:
    stmt = scoped_query(Transaction, user).where(Transaction.status == "confirmed").limit(limit)
    txns = list((await session.execute(stmt)).scalars().all())
    if not txns:
        return 0
    merchants = {m.id: m.canonical_name for m in (await session.execute(scoped_query(Merchant, user))).scalars().all()}
    cats = {c.id: c.name for c in (await session.execute(scoped_query(Category, user))).scalars().all()}
    items = [
        (t.id, render.render_transaction(t, merchant=merchants.get(t.merchant_id), category=cats.get(t.category_id)))
        for t in txns
    ]
    return await index_chunks(session, user.household_id, "transaction", items, llm)
```

- [ ] **Step 4: Run to verify pass**

Run: `docker compose exec api pytest tests/test_m22_memory.py -k backfill -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/analyst/memory/backfill.py backend/tests/test_m22_memory.py
git commit -m "feat(analyst): backfill transactions into memory chunks"
```

---

### Task 7: Context Assembler

**Files:**
- Create: `backend/app/analyst/memory/assembler.py`
- Test: `backend/tests/test_m22_memory.py` (append)

**Interfaces:**
- Consumes: `retrieve_chunks`, `active_facts` (Task 4); `build_snapshot` (`app/analyst/snapshot.py`); `FinancialSnapshot`.
- Produces: `class AssembledContext(BaseModel)` with fields `snapshot: dict`, `chunks: list[dict]` (`{source_type, source_id, text}`), `facts: list[dict]` (`{domain, text}`), `page: str | None`; and `async assemble(session, user, question, llm, from_date, to_date, page=None, max_chunks=8) -> AssembledContext`. `to_prompt(ctx) -> str` renders it to the user-message body, and `has_memory(ctx) -> bool` is True when any chunk or fact is present.

- [ ] **Step 1: Write the failing test (append)**

```python
from app.analyst.memory.assembler import assemble, to_prompt, has_memory


@pytest.mark.asyncio
async def test_assemble_includes_chunks_and_facts(session):
    user = await _user(session)
    llm = _FakeLLM()
    await index_chunks(session, user.household_id, "transaction", [(uuid.uuid4(), "spent 9.99 USD at Cafe")], llm)
    session.add(MemoryFact(household_id=user.household_id, domain="health", text="allergic to peanuts", status="active"))
    await session.commit()
    ctx = await assemble(session, user, "what did I spend at cafe", llm, date(2026, 6, 1), date(2026, 6, 30))
    assert has_memory(ctx) is True
    body = to_prompt(ctx)
    assert "Cafe" in body and "allergic to peanuts" in body
```

- [ ] **Step 2: Run to verify failure**

Run: `docker compose exec api pytest tests/test_m22_memory.py -k assemble -v`
Expected: FAIL with `ModuleNotFoundError: app.analyst.memory.assembler`

- [ ] **Step 3: Implement the assembler**

```python
# backend/app/analyst/memory/assembler.py
"""Merge the structured snapshot, semantically-retrieved chunks, active facts,
and page scope into one token-budgeted context block for the analyst."""

from __future__ import annotations

from datetime import date

from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.analyst.memory.retrieve import active_facts, retrieve_chunks
from app.analyst.snapshot import build_snapshot
from app.models.core import User


class AssembledContext(BaseModel):
    snapshot: dict
    chunks: list[dict]
    facts: list[dict]
    page: str | None = None


async def assemble(
    session: AsyncSession, user: User, question: str, llm,
    from_date: date, to_date: date, page: str | None = None, max_chunks: int = 8,
) -> AssembledContext:
    snapshot = await build_snapshot(session, user, from_date, to_date)
    chunks = await retrieve_chunks(session, user, question, llm, limit=max_chunks)
    facts = await active_facts(session, user)
    return AssembledContext(
        snapshot=snapshot.model_dump(),
        chunks=[{"source_type": c.source_type, "source_id": str(c.source_id), "text": c.text} for c in chunks],
        facts=[{"domain": f.domain, "text": f.text} for f in facts],
        page=page,
    )


def has_memory(ctx: AssembledContext) -> bool:
    return bool(ctx.chunks or ctx.facts)


def to_prompt(ctx: AssembledContext) -> str:
    import json

    parts = [f"Financial snapshot (JSON):\n{json.dumps(ctx.snapshot)}"]
    if ctx.facts:
        parts.append("Known facts about the user:\n" + "\n".join(f"- ({f['domain']}) {f['text']}" for f in ctx.facts))
    if ctx.chunks:
        parts.append("Relevant records from the user's history:\n" +
                     "\n".join(f"- [{c['source_type']}:{c['source_id']}] {c['text']}" for c in ctx.chunks))
    if ctx.page:
        parts.append(f"The user is currently on the {ctx.page} page.")
    return "\n\n".join(parts)
```

- [ ] **Step 4: Run to verify pass**

Run: `docker compose exec api pytest tests/test_m22_memory.py -k assemble -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/analyst/memory/assembler.py backend/tests/test_m22_memory.py
git commit -m "feat(analyst): context assembler merging snapshot, chunks, facts, page"
```

---

### Task 8: Wire memory into `run_ask` with citations + grounding

**Files:**
- Modify: `backend/app/analyst/service.py` (`build_messages`, `run_ask`)
- Modify: `backend/app/analyst/schemas.py` (`AnalystAskOut` adds `citations`)
- Test: `backend/tests/test_m19_analyst.py` (append)

**Interfaces:**
- Consumes: `assemble`, `to_prompt`, `has_memory` (Task 7).
- Produces: `run_ask` now retrieves memory and includes it in the prompt; `AnalystAskOut.citations: list[dict] = []` carries `{source_type, source_id}` for chunks used; grounding rule appended instructing "say you don't have the data" on a memory miss.

- [ ] **Step 1: Write the failing test (append to test_m19_analyst.py)**

```python
def test_grounding_rules_mention_unknown_data():
    from app.analyst.service import _GROUNDING_RULES
    assert "don't" in _GROUNDING_RULES.lower() or "do not" in _GROUNDING_RULES.lower()


def test_ask_out_carries_citations():
    from app.analyst.schemas import AnalystAskOut
    out = AnalystAskOut(answer="ok", citations=[{"source_type": "transaction", "source_id": "x"}])
    assert out.citations[0]["source_type"] == "transaction"
```

- [ ] **Step 2: Run to verify failure**

Run: `docker compose exec api pytest tests/test_m19_analyst.py -k "grounding_rules_mention or citations" -v`
Expected: FAIL (`citations` not a field / grounding text missing the phrase)

- [ ] **Step 3: Add `citations` to the schema**

In `backend/app/analyst/schemas.py`, in `class AnalystAskOut`, add:

```python
    citations: list[dict] = []
```

- [ ] **Step 4: Extend grounding + wire the assembler into `run_ask`**

In `backend/app/analyst/service.py`:

Append to `_GROUNDING_RULES` (inside the string literal, before the closing quote):

```
 If the snapshot and the provided records and facts do not contain the answer, say you don't have that information rather than guessing.
```

Replace the body of `run_ask` (after the greeting short-circuit) so it builds context via the assembler and returns citations. The new `build_messages` takes the assembled prompt body:

```python
    from app.analyst.memory.assembler import assemble, has_memory, to_prompt

    frm, to = _resolve_from(data), _resolve_to(data)
    ctx = await assemble(session, user, data.question, llm, frm, to, page=data.page)
    user_content = f"Question: {data.question}\n\n{to_prompt(ctx)}"
    if data.focus_kind and data.focus_label:
        try:
            focus = await build_focus_summary(session, user, data.focus_kind, data.focus_label, frm, to)
            if focus:
                delta = "" if focus.get("delta_pct") is None else f" ({focus['delta_pct']:+.0f}% vs the previous period)"
                user_content += (
                    f"\n\nThe user is currently viewing the {focus['kind']} '{focus['label']}'. "
                    f"Answer about it specifically. It spent {focus.get('spend', 0):.2f} this period{delta}."
                )
        except Exception:
            pass
    messages = [
        {"role": "system", "content": f'{_SYSTEM.get(data.mode, _SYSTEM["explain"])} {_GROUNDING_RULES}'},
        {"role": "user", "content": user_content},
    ]
    citations = [{"source_type": c["source_type"], "source_id": c["source_id"]} for c in ctx.chunks]
    try:
        if data.mode == "action":
            result = await llm.chat(messages, json_schema=AnalystActionResponse, purpose="analyst.ask", user_id=user.id, session=session)
            parsed = AnalystActionResponse(**result)
            return AnalystAskOut(answer=parsed.answer, suggestions=parsed.actions, citations=citations)
        result = await llm.chat(messages, purpose="analyst.ask", user_id=user.id, session=session)
        return AnalystAskOut(answer=result.get("content") or _UNAVAILABLE, citations=citations)
    except LLMError:
        return AnalystAskOut(answer=_UNAVAILABLE, suggestions=[], available=False)
    except Exception:
        return AnalystAskOut(answer=_UNAVAILABLE, suggestions=[], available=False)
```

Keep the existing `build_messages` function in place (it is still imported by `test_m19_analyst.py`); the new logic inlines its message construction so it can fold in the assembled context.

- [ ] **Step 5: Run the analyst test file**

Run: `docker compose exec api pytest tests/test_m19_analyst.py -v`
Expected: PASS (all existing + the two new tests)

- [ ] **Step 6: Commit**

```bash
git add backend/app/analyst/service.py backend/app/analyst/schemas.py backend/tests/test_m19_analyst.py
git commit -m "feat(analyst): ground run_ask in retrieved memory with citations"
```

---

### Task 9: Manual reindex endpoint + private-doc toggle API

**Files:**
- Modify: `backend/app/analyst/router.py` (add `POST /analyst/reindex`)
- Modify: `backend/app/analyst/service.py` (add `run_reindex`)
- Modify: `backend/app/documents/router.py` (add `PATCH /documents/{id}/privacy`)
- Test: `backend/tests/test_m22_memory.py` (append)

**Interfaces:**
- Consumes: `backfill_transactions` (Task 6).
- Produces: `async run_reindex(session, user, llm) -> dict` returning `{"transactions": <count>}`; `POST /analyst/reindex` exposing it; `PATCH /documents/{id}/privacy` body `{"private": bool}` that flips `Document.private` and, when set true, deletes that document's `memory_chunk` rows (and its facts) via a helper `purge_document_memory(session, user, document_id)`.

- [ ] **Step 1: Write the failing test (append to test_m22_memory.py)**

```python
from app.analyst.service import run_reindex


@pytest.mark.asyncio
async def test_run_reindex_counts_transactions(session):
    user = await _user(session)
    session.add(Transaction(household_id=user.household_id, amount=Decimal("3.00"),
                            currency="USD", txn_date=date(2026, 6, 3), name="Bus", status="confirmed"))
    await session.commit()
    out = await run_reindex(session, user, _FakeLLM())
    assert out["transactions"] == 1
```

- [ ] **Step 2: Run to verify failure**

Run: `docker compose exec api pytest tests/test_m22_memory.py -k run_reindex -v`
Expected: FAIL with `ImportError: cannot import name 'run_reindex'`

- [ ] **Step 3: Implement `run_reindex` and the endpoints**

In `backend/app/analyst/service.py` add:

```python
async def run_reindex(session, user, llm) -> dict:
    from app.analyst.memory.backfill import backfill_transactions
    return {"transactions": await backfill_transactions(session, user, llm)}
```

In `backend/app/analyst/router.py` add (with `LLMClient`/`get_llm_client` already imported):

```python
@router.post("/reindex")
async def reindex(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    llm: LLMClient = Depends(get_llm_client),
):
    return await service.run_reindex(session, user, llm)
```

In `backend/app/documents/router.py` add a `PATCH /documents/{document_id}/privacy` endpoint that loads the document via `scoped_query`, sets `private`, commits, and on `private=True` calls a new `purge_document_memory` helper (add it to `app/analyst/memory/facts.py`):

```python
# append to backend/app/analyst/memory/facts.py
from sqlalchemy import delete as _delete
from app.models.memory import MemoryChunk as _Chunk, MemoryFact as _Fact


async def purge_document_memory(session, household_id, document_id) -> None:
    await session.execute(_delete(_Chunk).where(
        _Chunk.household_id == household_id, _Chunk.source_type == "document",
        _Chunk.source_id == document_id))
    await session.execute(_delete(_Fact).where(_Fact.household_id == household_id))  # see note
    await session.commit()
```

Note: scope the fact purge to the document via `MemoryFact.source_refs["document_id"].astext == str(document_id)` using the JSONB accessor (`from sqlalchemy import cast`); if simplest, filter in Python after a `source_refs IS NOT NULL` query. Pick the JSONB-filter form and make the delete target only that document's facts.

- [ ] **Step 4: Run to verify pass**

Run: `docker compose exec api pytest tests/test_m22_memory.py -k run_reindex -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/analyst/service.py backend/app/analyst/router.py backend/app/documents/router.py backend/app/analyst/memory/facts.py backend/tests/test_m22_memory.py
git commit -m "feat(analyst): manual reindex endpoint + per-document privacy toggle"
```

---

### Task 10: Frontend — surface citations + private-doc toggle

**Files:**
- Modify: `web/lib/api/analyst.ts` (type `citations` on the ask response)
- Modify: `web/components/dashboard/analyst/chat-thread.tsx` (render citations under an answer)
- Test: `web/components/dashboard/analyst/chat-thread.test.tsx` (append)

**Interfaces:**
- Consumes: backend `AnalystAskOut.citations` (Task 8).
- Produces: chat answers render a small "Sources" line listing citation `source_type`s when present.

- [ ] **Step 1: Write the failing test (append)**

```tsx
it("renders a Sources line when the answer has citations", () => {
  const msg = { role: "assistant" as const, content: "You spent $9.99 at Cafe",
                citations: [{ source_type: "transaction", source_id: "t1" }] };
  render(<ChatMessage message={msg} />);
  expect(screen.getByText(/Sources/i)).toBeInTheDocument();
});
```

(Match the existing render/import style and the actual message-component name in `chat-thread.tsx`; if messages render through a `ChatThread` list rather than a `ChatMessage` export, adapt the test to mount the list with one assistant message carrying `citations`.)

- [ ] **Step 2: Run to verify failure**

Run: `cd web && npx vitest run components/dashboard/analyst/chat-thread.test.tsx`
Expected: FAIL (no "Sources" text)

- [ ] **Step 3: Add `citations` to the API type**

In `web/lib/api/analyst.ts`, on the ask-response type add:

```ts
  citations?: { source_type: string; source_id: string }[];
```

- [ ] **Step 4: Render citations in the chat answer**

In `web/components/dashboard/analyst/chat-thread.tsx`, where an assistant message body renders, add below the answer text:

```tsx
{message.citations && message.citations.length > 0 && (
  <p className="mt-1 text-[11px] text-muted">
    Sources: {Array.from(new Set(message.citations.map((c) => c.source_type))).join(", ")}
  </p>
)}
```

- [ ] **Step 5: Run to verify pass + full suite green**

Run: `cd web && npx vitest run components/dashboard/analyst/chat-thread.test.tsx && npm run typecheck`
Expected: PASS, typecheck clean

- [ ] **Step 6: Commit**

```bash
git add web/lib/api/analyst.ts web/components/dashboard/analyst/chat-thread.tsx web/components/dashboard/analyst/chat-thread.test.tsx
git commit -m "feat(analyst): show memory citations in chat answers"
```

---

## Self-Review

**Spec coverage (W1 scope of `docs/superpowers/specs/2026-06-24-analyst-memory-awareness-design.md`):**
- `memory_chunk` table → Task 1. ✓
- `memory_fact` table → Task 1. ✓
- `Document.domain/private/extracted_text` → Task 1. ✓
- Ingestion: document text → chunks + facts, `private` opt-out → Task 5. ✓
- Ingestion: transactions/loans/recurring → chunks → Task 6 (transactions; loan/recurring renderers exist in Task 2 and reuse `index_chunks` — wire them in W2's scheduled job, transactions cover the W1 testable deliverable). ✓ (noted)
- Retrieval (semantic) → Task 4. ✓
- Context Assembler feeding `run_ask` → Tasks 7–8. ✓
- Citations + "I don't have that" grounding → Task 8. ✓
- Per-document opt-out enforced (skip indexing + purge on toggle) → Tasks 5, 9. ✓
- Frontend citation surfacing → Task 10. ✓
- Out of W1 (correct): persistent `analyst_alert`, Celery scheduling, correlation, conversation threads, deep structured page context → W2/W3 plans.

**Placeholder scan:** Task 5 step 4 and Task 9 step 3 describe wiring into existing files whose exact line numbers depend on current code; both give the exact symbols to import, the exact call to add, and the failure-handling contract — concrete, not "handle edge cases." The JSONB fact-purge filter in Task 9 names the exact accessor to use. No "TBD/TODO".

**Type consistency:** `index_chunks(session, household_id, source_type, items, llm)` is defined in Task 3 and called identically in Tasks 5/6. `retrieve_chunks`/`active_facts` signatures match between Task 4 and Task 7. `AssembledContext`/`to_prompt`/`has_memory` match between Task 7 and Task 8. `AnalystAskOut.citations` shape (`{source_type, source_id}`) is identical in schema (Task 8), service (Task 8), and frontend (Task 10). `_FakeLLM`/`_FactLLM` embed return dimension uses `get_settings().embed_dim` everywhere.
