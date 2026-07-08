# backend/tests/test_m22_memory.py
from __future__ import annotations

import os
import uuid
from types import SimpleNamespace
from datetime import date
from decimal import Decimal

import pytest
import pytest_asyncio
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models.core import Household, User
from app.models.memory import MemoryChunk, MemoryFact
from app.analyst.memory.render import render_transaction, chunk_text

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


def test_render_transaction_is_one_grounded_sentence():
    txn = SimpleNamespace(txn_date=date(2026, 6, 1), amount=Decimal("12.50"),
                          currency="USD", name="Blue Bottle Coffee", notes=None)
    out = render_transaction(txn, merchant="Blue Bottle", category="Dining")
    assert "2026-06-01" in out and "12.50" in out and "USD" in out
    assert "Blue Bottle" in out and "Dining" in out


def test_chunk_text_splits_long_text_under_limit():
    parts = chunk_text("para one.\n\n" + ("x" * 900) + "\n\nlast.", max_chars=800)
    assert len(parts) >= 2 and all(len(p) <= 800 for p in parts)


# ---------------------------------------------------------------------------
# Task 3: Indexer
# ---------------------------------------------------------------------------

from app.analyst.memory.indexer import index_chunks  # noqa: E402


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


# ---------------------------------------------------------------------------
# Task 4: Retriever
# ---------------------------------------------------------------------------

from app.analyst.memory.retrieve import retrieve_chunks, active_facts  # noqa: E402


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


# ---------------------------------------------------------------------------
# Task 5: Document fact extraction
# ---------------------------------------------------------------------------

from app.analyst.memory.facts import extract_facts, ExtractedFacts  # noqa: E402
from app.models.documents import Document  # noqa: E402


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


# ---------------------------------------------------------------------------
# Task 6: Backfill indexer for existing transactions
# ---------------------------------------------------------------------------

from app.analyst.memory.backfill import backfill_transactions  # noqa: E402
from app.models.transactions import Transaction  # noqa: E402


@pytest.mark.asyncio
async def test_backfill_indexes_transactions(session):
    user = await _user(session)
    session.add(Transaction(household_id=user.household_id, amount=Decimal("9.99"),
                            currency="USD", txn_date=date(2026, 6, 2), status="confirmed"))
    await session.commit()
    n = await backfill_transactions(session, user, _FakeLLM())
    rows = (await session.execute(select(MemoryChunk).where(
        MemoryChunk.household_id == user.household_id,
        MemoryChunk.source_type == "transaction"))).scalars().all()
    assert n == 1 and len(rows) == 1 and "9.99" in rows[0].text


# ---------------------------------------------------------------------------
# Task 7: Context Assembler
# ---------------------------------------------------------------------------

from app.analyst.memory.assembler import AssembledContext, assemble, has_memory, to_prompt  # noqa: E402


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


@pytest.mark.asyncio
async def test_assemble_renders_structured_page_context(session):
    user = await _user(session)
    llm = _FakeLLM()
    ctx = await assemble(
        session,
        user,
        "why is dining up",
        llm,
        date(2026, 6, 1),
        date(2026, 6, 30),
        page_context={
            "route": "/transactions",
            "entity": "Dining",
            "visible_range": "2026-06-01..2026-06-30",
            "filters": {"category": "Dining"},
        },
    )
    body = to_prompt(ctx)
    assert "/transactions" in body and "Dining" in body
    assert "Current view" in body


def test_to_prompt_serializes_snapshot_dates():
    body = to_prompt(
        AssembledContext(
            snapshot={"period_from": date(2026, 6, 1), "period_to": date(2026, 6, 30)},
            chunks=[],
            facts=[],
        )
    )
    assert "2026-06-01" in body and "2026-06-30" in body


# ---------------------------------------------------------------------------
# Task 9: Manual reindex endpoint + per-document privacy toggle
# ---------------------------------------------------------------------------

from app.analyst.service import run_reindex  # noqa: E402


@pytest.mark.asyncio
async def test_run_reindex_counts_transactions(session):
    user = await _user(session)
    session.add(Transaction(household_id=user.household_id, amount=Decimal("3.00"),
                            currency="USD", txn_date=date(2026, 6, 3), status="confirmed"))
    await session.commit()
    out = await run_reindex(session, user, _FakeLLM())
    assert out["transactions"] == 1
