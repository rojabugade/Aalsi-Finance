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
    user = User(household_id=hh.id, email=f"{uuid.uuid4().hex}@example.com", password_hash="x")
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
async def test_index_source_indexes_account_record(session):
    from app.analyst.memory.ingest import index_source
    from app.models.accounts import AccountLogical

    user = await _user(session)
    account = AccountLogical(
        household_id=user.household_id,
        label="Main Checking",
        type="checking",
        currency="USD",
        mask="1234",
    )
    session.add(account)
    await session.commit()

    n = await index_source(session, user.household_id, "account", [account.id], _FakeLLM())
    row = (await session.execute(
        select(MemoryChunk).where(MemoryChunk.source_id == account.id))).scalar_one()
    assert n == 1
    assert row.source_type == "account"
    assert "Main Checking" in row.text
    assert "1234" in row.text


@pytest.mark.asyncio
async def test_index_source_indexes_non_private_document_text(session):
    from app.analyst.memory.ingest import index_source
    from app.models.documents import Document

    user = await _user(session)
    document = Document(
        household_id=user.household_id,
        storage_key="pytest/doc.txt",
        type="statement",
        source_channel="upload",
        status="processed",
        domain="finance",
        private=False,
        extracted_text="Statement says account balance is 100 USD.",
    )
    private_doc = Document(
        household_id=user.household_id,
        storage_key="pytest/private.txt",
        type="statement",
        source_channel="upload",
        status="processed",
        domain="finance",
        private=True,
        extracted_text="Private note should not be indexed.",
    )
    session.add_all([document, private_doc])
    await session.commit()

    n = await index_source(session, user.household_id, "document", [document.id, private_doc.id], _FakeLLM())
    rows = (await session.execute(
        select(MemoryChunk).where(MemoryChunk.household_id == user.household_id))).scalars().all()
    assert n == 1
    assert {row.source_id for row in rows} == {document.id}
    assert "Statement says account balance" in rows[0].text


@pytest.mark.asyncio
async def test_index_source_unknown_type_is_noop(session):
    from app.analyst.memory.ingest import index_source

    user = await _user(session)
    n = await index_source(session, user.household_id, "nope", [uuid.uuid4()], _FakeLLM())
    assert n == 0


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
    from app.models.accounts import AccountLogical
    from app.models.transactions import Transaction

    user = await _user(session)
    session.add_all([
        Transaction(household_id=user.household_id, amount=Decimal("4.00"),
                    currency="USD", txn_date=date(2026, 6, 4), status="confirmed"),
        AccountLogical(household_id=user.household_id, label="Main Checking",
                       type="checking", currency="USD"),
    ])
    await session.commit()
    out = await run_reindex(session, user, _FakeLLM())
    assert out["transactions"] == 1
    assert out["accounts"] == 1
    for key in [
        "documents", "loans", "recurring", "account_balances", "payment_methods", "budgets",
        "merchants", "categories", "tags", "rules", "income_sources",
        "investment_holdings", "holding_valuations",
    ]:
        assert key in out


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


@pytest.mark.asyncio
async def test_run_ask_recent_transaction_answers_from_indexed_records(session):
    from app.analyst.memory.ingest import index_source
    from app.analyst.schemas import AnalystAskIn
    from app.analyst.service import run_ask
    from app.models.transactions import Transaction

    user = await _user(session)
    old = Transaction(household_id=user.household_id, amount=Decimal("5.00"),
                      currency="USD", txn_date=date(2026, 1, 1), status="confirmed")
    recent = Transaction(household_id=user.household_id, amount=Decimal("20.37"),
                         currency="USD", txn_date=date(2026, 6, 30), status="confirmed")
    session.add_all([old, recent])
    await session.commit()
    await index_source(session, user.household_id, "transaction", [old.id, recent.id], _FakeLLM())

    out = await run_ask(
        session,
        user,
        AnalystAskIn(mode="plan", question="my recent transaction", thread_id="dashboard-test"),
        _FakeLLM(),
    )

    assert "Your recent transactions are:" in out.answer
    assert "On 2026-06-30, spent 20.37 USD" in out.answer
    assert out.citations[0]["source_id"] == str(recent.id)
    assert out.thread_id == "dashboard-test"


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
