from __future__ import annotations

import os
import uuid
from datetime import date
from decimal import Decimal

import pytest
import pytest_asyncio
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.fx.service import convert, upsert_rate
from app.models.core import Household, User
from app.models.transactions import Transaction
from app.transactions.schemas import TransactionCreate
from app.transactions.service import create_transaction

TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://finance:finance@localhost:5433/finance",
)

HOUSEHOLD_PREFIX = "pytest-m14-"


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
        await conn.execute(text("DELETE FROM household WHERE name LIKE :p"), {"p": f"{HOUSEHOLD_PREFIX}%"})
        await conn.execute(text("DELETE FROM fx_rate WHERE currency_pair IN ('INR/USD', 'USD/INR')"))
    await eng.dispose()


@pytest_asyncio.fixture
async def session(engine):
    sm = async_sessionmaker(engine, expire_on_commit=False)
    async with sm() as s:
        yield s


async def _user(session, base_currency: str = "USD") -> User:
    household = Household(name=f"{HOUSEHOLD_PREFIX}{uuid.uuid4().hex[:8]}", base_currency=base_currency)
    session.add(household)
    await session.flush()
    user = User(
        household_id=household.id,
        email=f"{uuid.uuid4().hex}@example.com",
        password_hash="x",
    )
    session.add(user)
    await session.flush()
    return user


@pytest.mark.asyncio
async def test_convert_uses_exact_rate(session):
    await upsert_rate(session, "INR/USD", date(2026, 1, 15), Decimal("0.01200000"))

    amount, rate, rate_date = await convert(session, Decimal("1000.00"), "INR", "USD", date(2026, 1, 15))

    assert amount == Decimal("12.00")
    assert rate == Decimal("0.01200000")
    assert rate_date == date(2026, 1, 15)


@pytest.mark.asyncio
async def test_convert_uses_nearest_prior_rate(session):
    await upsert_rate(session, "INR/USD", date(2026, 1, 10), Decimal("0.01100000"))
    await upsert_rate(session, "INR/USD", date(2026, 1, 12), Decimal("0.01250000"))

    amount, rate, rate_date = await convert(session, Decimal("1000.00"), "INR", "USD", date(2026, 1, 14))

    assert amount == Decimal("12.50")
    assert rate == Decimal("0.01250000")
    assert rate_date == date(2026, 1, 12)


@pytest.mark.asyncio
async def test_identity_conversion_needs_no_rate(session):
    amount, rate, rate_date = await convert(session, Decimal("42.75"), "USD", "USD", date(2026, 2, 1))

    assert amount == Decimal("42.75")
    assert rate == Decimal("1.00000000")
    assert rate_date == date(2026, 2, 1)


@pytest.mark.asyncio
async def test_transaction_create_snapshots_base_amount_and_fx_rate(session):
    user = await _user(session, base_currency="USD")
    await upsert_rate(session, "INR/USD", date(2026, 1, 10), Decimal("0.01250000"))

    txn = await create_transaction(
        session,
        user,
        TransactionCreate(
            merchant="Cafe",
            amount=Decimal("800.00"),
            currency="INR",
            txn_date=date(2026, 1, 11),
            status="draft",
        ),
    )

    persisted = (await session.execute(select(Transaction).where(Transaction.id == txn.id))).scalar_one()
    assert persisted.fx_rate == Decimal("0.01250000")
    assert persisted.base_amount == Decimal("10.00")
