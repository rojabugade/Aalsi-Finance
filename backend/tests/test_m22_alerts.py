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


def test_analyst_scan_task_registered():
    import app.tasks.analyst  # noqa: F401  (force task registration)
    from app.celery_app import celery
    assert "analyst.scan_alerts" in celery.tasks
    assert "analyst-scan-alerts-daily" in celery.conf.beat_schedule


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
