"""Spend analytics must treat enrichment flags correctly: transfer legs are
money movement (never spend), refund inflows net their category down."""
from __future__ import annotations

import os
import uuid
from datetime import date
from decimal import Decimal

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.analytics import service as analytics_service
from app.models.accounts import AccountLogical
from app.models.core import Household, User
from app.models.transactions import Category
from app.transactions.schemas import TransactionCreate
from app.transactions import service as txn_service

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL", "postgresql+asyncpg://finance:finance@localhost:5433/finance")
HOUSEHOLD_PREFIX = "pytest-m7flags-"


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


async def _fixture(session):
    hh = Household(name=f"{HOUSEHOLD_PREFIX}{uuid.uuid4().hex[:8]}", base_currency="USD")
    session.add(hh)
    await session.flush()
    user = User(household_id=hh.id, email=f"{uuid.uuid4().hex}@example.com", password_hash="x")
    session.add(user)
    await session.flush()
    chk = AccountLogical(household_id=hh.id, owner_user_id=user.id, label="Checking", type="checking", currency="USD")
    card = AccountLogical(household_id=hh.id, owner_user_id=user.id, label="Card", type="credit", currency="USD")
    session.add_all([chk, card])
    await session.commit()
    return user, chk, card


async def _txn(session, user, account, amount, day, external_id, flags=None, merchant="Amazon", category_id=None):
    t = await txn_service.create_transaction(session, user, TransactionCreate(
        account_id=account.id, merchant=merchant, amount=Decimal(amount), currency="USD",
        txn_date=date(2026, 6, day), status="confirmed", source_channel="plaid",
        external_id=external_id, flags=flags,
    ))
    if category_id is not None:
        t.category_id = category_id
        await session.commit()
    return t


@pytest.mark.asyncio
async def test_breakdown_nets_refunds_and_skips_transfers(session):
    user, chk, card = await _fixture(session)
    cat = Category(household_id=user.household_id, name="Shopping", kind="category")
    session.add(cat)
    await session.commit()

    await _txn(session, user, card, "-100.00", 5, "t-buy2", category_id=cat.id)
    await _txn(session, user, card, "100.00", 8, "t-ref2", flags={"refund": True}, category_id=cat.id)
    await _txn(session, user, chk, "-250.00", 9, "t-tr2", flags={"transfer": True}, category_id=cat.id)

    out = await analytics_service.breakdown(session, user, "category", None, date(2026, 6, 1), date(2026, 6, 30))
    shopping = [r for r in out["rows"] if r["dimensions"].get("category") == "Shopping"]
    total = shopping[0]["total"] if shopping else Decimal("0.00")
    assert total == Decimal("0.00")  # refund nets the purchase; transfer leg never counted
