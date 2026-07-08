from __future__ import annotations

import os
import uuid
from datetime import date
from decimal import Decimal

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.ingestion.service import (
    NotFound,
    delete_splitwise_connection,
    splitwise_balances,
    splitwise_oauth_callback,
    splitwise_sync,
)
from app.models.core import Household, User
from app.models.documents import Document
from app.models.fx import FXRate

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL", "postgresql+asyncpg://finance:finance@localhost:5433/finance")
HOUSEHOLD_PREFIX = "pytest-splitwise-"


class FakeSplitwise:
    def authorization_url(self, state):
        return f"https://secure.splitwise.com/oauth/authorize?state={state}"

    async def exchange_code(self, code):
        return {"access_token": f"at-{code}"}

    async def get_balances(self, access_token):
        return [{"friend": "Alice", "amount": "-24.00", "currency": "USD"}]


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
    user = User(household_id=hh.id, email=f"{uuid.uuid4().hex}@example.com", password_hash="x", role="owner")
    session.add(user)
    await session.merge(FXRate(currency_pair="USD/INR", date=date(2026, 6, 14), rate=Decimal("83.00")))
    await session.flush()
    return user


@pytest.mark.asyncio
async def test_callback_then_sync_returns_events(session):
    user = await _user(session)
    await splitwise_oauth_callback(session, user, code="abc", state=f"{user.id}:x", gateway=FakeSplitwise())
    out = await splitwise_sync(session, user, FakeSplitwise())
    assert out["balances_count"] == 1
    assert out["events"][0]["friend"] == "Alice"


@pytest.mark.asyncio
async def test_splitwise_balances_returns_latest(session):
    user = await _user(session)
    doc = Document(
        household_id=user.household_id, uploaded_by_user_id=user.id,
        storage_key=f"splitwise://{uuid.uuid4()}", type="other", source_channel="splitwise",
        status="processed",
        ocr_meta={"splitwise": {"events": [{"friend": "Sam", "amount": "12.50", "currency": "USD"}]}},
    )
    session.add(doc)
    await session.commit()

    result = await splitwise_balances(session, user)
    assert result["balances"] == [{"friend": "Sam", "amount": "12.50", "currency": "USD"}]
    assert result["synced_at"] is not None


@pytest.mark.asyncio
async def test_balances_empty_when_never_synced(session):
    user = await _user(session)
    result = await splitwise_balances(session, user)
    assert result == {"balances": [], "synced_at": None}


@pytest.mark.asyncio
async def test_disconnect_revokes(session):
    user = await _user(session)
    await splitwise_oauth_callback(session, user, code="abc", state=f"{user.id}:x", gateway=FakeSplitwise())
    await delete_splitwise_connection(session, user)
    with pytest.raises(NotFound):
        await splitwise_sync(session, user, FakeSplitwise())
