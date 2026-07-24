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
    user = User(household_id=hh.id, email=f"{uuid.uuid4().hex}@example.com", password_hash="x")
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
