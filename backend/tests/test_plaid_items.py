from __future__ import annotations

import os
import uuid
from datetime import date
from decimal import Decimal

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.ingestion.schemas import PlaidExchangeIn
from app.ingestion.service import list_plaid_items, plaid_exchange
from app.models.core import Household, User
from app.models.fx import FXRate

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL", "postgresql+asyncpg://finance:finance@localhost:5433/finance")
HOUSEHOLD_PREFIX = "pytest-plaiditems-"


class FakePlaid:
    async def exchange_public_token(self, public_token: str) -> dict:
        return {"access_token": f"access-{public_token}"}


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
    await eng.dispose()


@pytest_asyncio.fixture
async def session(engine):
    sm = async_sessionmaker(engine, expire_on_commit=False)
    async with sm() as s:
        yield s


async def _user(session):
    hh = Household(name=f"{HOUSEHOLD_PREFIX}{uuid.uuid4().hex[:8]}", base_currency="USD")
    session.add(hh)
    await session.flush()
    user = User(household_id=hh.id, email=f"{uuid.uuid4().hex}@example.com", password_hash="x")
    session.add(user)
    await session.merge(FXRate(currency_pair="USD/INR", date=date(2026, 6, 14), rate=Decimal("83.00")))
    await session.flush()
    return user


@pytest.mark.asyncio
async def test_list_plaid_items_returns_connected(session):
    user = await _user(session)
    await plaid_exchange(
        session,
        user,
        PlaidExchangeIn(
            public_token="pt",
            institution_name="Chase",
            accounts=[{"name": "Checking", "account_id": "a1", "type": "depository"}],
        ),
        FakePlaid(),
    )
    items = await list_plaid_items(session, user)
    assert len(items) == 1
    assert items[0]["institution_name"] == "Chase"
    assert items[0]["account_count"] == 1
