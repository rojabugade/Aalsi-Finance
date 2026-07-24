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


import os
import uuid
from datetime import date, timedelta
from decimal import Decimal

import pytest
import pytest_asyncio
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models.core import Household, User
from app.models.transactions import Merchant, RecurringSeries, Transaction
from app.transactions.service import detect_recurring

TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL", "postgresql+asyncpg://finance:finance@localhost:5433/finance"
)
HH = "pytest-m21r-"


@pytest_asyncio.fixture
async def engine():
    eng = create_async_engine(TEST_DATABASE_URL)
    try:
        async with eng.connect() as c:
            await c.execute(text("SELECT 1"))
    except Exception as exc:  # noqa: BLE001
        await eng.dispose()
        pytest.skip(f"no Postgres: {exc}")
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
    session.add(hh)
    await session.flush()
    user = User(
        household_id=hh.id,
        email=f"{uuid.uuid4().hex}@e.com",
        password_hash="x",
    )
    merchant = Merchant(household_id=hh.id, canonical_name="Netflix")
    session.add_all([user, merchant])
    await session.flush()
    return hh, user, merchant


@pytest.mark.asyncio
async def test_detect_creates_single_series_for_monthly_pattern(session):
    hh, user, merchant = await _seed(session)
    base = date.today() - timedelta(days=120)
    txns = []
    for i in range(4):
        t = Transaction(
            household_id=hh.id,
            owner_user_id=user.id,
            merchant_id=merchant.id,
            amount=Decimal("-15.99"),
            base_amount=Decimal("-15.99"),
            currency="USD",
            txn_date=base + timedelta(days=30 * i),
            source_channel="test",
            external_id=f"nf-{uuid.uuid4().hex}",
        )
        session.add(t)
        txns.append(t)
    await session.flush()
    for t in txns:
        await detect_recurring(session, t)
    await session.flush()
    series = list(
        (
            await session.execute(
                select(RecurringSeries).where(RecurringSeries.household_id == hh.id)
            )
        ).scalars().all()
    )
    assert len(series) == 1
    assert series[0].cadence == "monthly"
    assert series[0].type == "subscription"
    assert txns[-1].recurring_series_id == series[0].id


@pytest.mark.asyncio
async def test_detect_types_positive_recurring_as_income(session):
    """Canonical sign: money in is positive — a repeating inflow is a paycheck,
    not a bill (regression: sign was inverted, typing rent as income)."""
    hh, user, merchant = await _seed(session)
    base = date.today() - timedelta(days=60)
    txns = []
    for i in range(4):
        t = Transaction(
            household_id=hh.id,
            owner_user_id=user.id,
            merchant_id=merchant.id,
            amount=Decimal("2000.00"),
            base_amount=Decimal("2000.00"),
            currency="USD",
            txn_date=base + timedelta(days=14 * i),
            source_channel="test",
            external_id=f"pay-{uuid.uuid4().hex}",
        )
        session.add(t)
        txns.append(t)
    await session.flush()
    for t in txns:
        await detect_recurring(session, t)
    await session.flush()
    series = list(
        (
            await session.execute(
                select(RecurringSeries).where(RecurringSeries.household_id == hh.id)
            )
        ).scalars().all()
    )
    assert len(series) == 1
    assert series[0].cadence == "biweekly"
    assert series[0].type == "income"
