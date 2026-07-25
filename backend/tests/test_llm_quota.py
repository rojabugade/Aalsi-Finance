"""Per-user LLM spend cap.

Guards the failure mode that matters on a public signup page: one account driving
unbounded spend on the deployment's own API key.
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import get_settings
from app.llm.errors import LLMQuotaExceeded
from app.llm.quota import check_quota
from app.models.core import Household, LLMUsageLog, User

TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://finance:finance@localhost:5433/finance",
)

HOUSEHOLD_PREFIX = "pytest-quota-"


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
        await conn.execute(
            text("DELETE FROM household WHERE name LIKE :p"), {"p": f"{HOUSEHOLD_PREFIX}%"}
        )
    await eng.dispose()


@pytest_asyncio.fixture
async def session(engine):
    async with async_sessionmaker(engine, expire_on_commit=False)() as s:
        yield s


@pytest.fixture
def limits():
    """Set the caps on the cached Settings and restore them afterwards."""
    settings = get_settings()
    before = (settings.llm_daily_cost_limit_usd, settings.llm_monthly_cost_limit_usd)

    def _apply(daily: float, monthly: float) -> None:
        settings.llm_daily_cost_limit_usd = daily
        settings.llm_monthly_cost_limit_usd = monthly

    yield _apply
    settings.llm_daily_cost_limit_usd, settings.llm_monthly_cost_limit_usd = before


async def _user(session) -> User:
    hh = Household(name=f"{HOUSEHOLD_PREFIX}{uuid.uuid4().hex[:8]}", base_currency="USD")
    session.add(hh)
    await session.flush()
    user = User(
        household_id=hh.id, email=f"{uuid.uuid4().hex}@example.com", password_hash="x"
    )
    session.add(user)
    await session.flush()
    return user


async def _spend(session, user: User, amount: str, *, days_ago: float = 0) -> None:
    row = LLMUsageLog(
        user_id=user.id,
        provider="openai",
        model="gpt-4o-mini",
        tokens_in=100,
        tokens_out=100,
        cost_est=Decimal(amount),
        purpose="test",
    )
    session.add(row)
    await session.flush()
    if days_ago:
        row.created_at = datetime.now(timezone.utc) - timedelta(days=days_ago)
        await session.flush()


@pytest.mark.asyncio
async def test_under_the_cap_is_allowed(session, limits):
    limits(1.0, 0.0)
    user = await _user(session)
    await _spend(session, user, "0.40")
    await check_quota(session, user.id)  # does not raise


@pytest.mark.asyncio
async def test_daily_cap_blocks_once_reached(session, limits):
    limits(1.0, 0.0)
    user = await _user(session)
    await _spend(session, user, "1.00")
    with pytest.raises(LLMQuotaExceeded):
        await check_quota(session, user.id)


@pytest.mark.asyncio
async def test_daily_window_rolls_off(session, limits):
    """Spend older than 24h must not count against the daily cap."""
    limits(1.0, 0.0)
    user = await _user(session)
    await _spend(session, user, "5.00", days_ago=2)
    await check_quota(session, user.id)


@pytest.mark.asyncio
async def test_monthly_cap_blocks_spend_spread_across_days(session, limits):
    limits(0.0, 10.0)
    user = await _user(session)
    for days_ago in (1, 5, 20):
        await _spend(session, user, "4.00", days_ago=days_ago)
    with pytest.raises(LLMQuotaExceeded):
        await check_quota(session, user.id)


@pytest.mark.asyncio
async def test_one_users_spend_does_not_block_another(session, limits):
    limits(1.0, 0.0)
    spender = await _user(session)
    bystander = await _user(session)
    await _spend(session, spender, "5.00")
    await check_quota(session, bystander.id)


@pytest.mark.asyncio
async def test_zero_limits_disable_the_cap(session, limits):
    limits(0.0, 0.0)
    user = await _user(session)
    await _spend(session, user, "999.00")
    await check_quota(session, user.id)


@pytest.mark.asyncio
async def test_unattributed_calls_are_not_capped(session, limits):
    """Background sweeps have no user to bill and must not be blocked."""
    limits(0.01, 0.01)
    await check_quota(session, None)
    await check_quota(None, uuid.uuid4())


@pytest.mark.asyncio
async def test_quota_error_is_not_retryable():
    # Retrying cannot help until the window rolls over, so the gateway's retry
    # wrapper must not spin on it.
    assert LLMQuotaExceeded("x").retryable is False
