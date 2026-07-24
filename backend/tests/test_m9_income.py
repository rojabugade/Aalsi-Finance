from __future__ import annotations

import os
import uuid
from datetime import date, timedelta
from decimal import Decimal

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.income.schemas import EquityEventIn, EquityGrantIn, IncomeSourceIn, PaystubIn
from app.income.service import create_equity_event, create_equity_grant, create_income_source, create_paystub, equity_summary, take_home_estimate
from app.models.core import Household, User
from app.models.documents import Document

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL", "postgresql+asyncpg://finance:finance@localhost:5433/finance")
HOUSEHOLD_PREFIX = "pytest-m9-"


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
    await session.flush()
    return user


@pytest.mark.asyncio
async def test_income_paystub_takehome_and_rsu_summary(session):
    user = await _user(session)
    source = await create_income_source(session, user, IncomeSourceIn(employer="Acme", country="US", currency="USD", frequency="monthly", gross=Decimal("10000")))
    doc = Document(
        household_id=user.household_id,
        uploaded_by_user_id=user.id,
        storage_key="test://paystub",
        type="paystub",
        source_channel="upload",
        status="processed",
        ocr_meta={"ocr": {"data": {"employer": "Acme", "period_start": "2026-05-01", "period_end": "2026-05-31", "gross": "10000.00", "net": "7200.00", "deductions": [{"name": "tax", "amount": "2800.00"}]}}},
    )
    session.add(doc)
    await session.commit()

    paystub = await create_paystub(session, user, PaystubIn(income_source_id=source.id, source_document_id=doc.id))
    assert paystub.net == Decimal("7200.00")

    take_home = await take_home_estimate(session, user, source.id)
    assert take_home["estimates"]["us"]["fica"] != "0.00"
    assert "Illustrative" in take_home["disclaimer"]

    grant = await create_equity_grant(
        session,
        user,
        EquityGrantIn(
            income_source_id=source.id,
            type="rsu",
            ticker="ACME",
            country="US",
            grant_date=date.today(),
            shares=Decimal("100"),
            vesting_schedule={"events": [{"date": str(date.today() + timedelta(days=30)), "shares": "25"}]},
        ),
    )
    event = await create_equity_event(session, user, EquityEventIn(equity_grant_id=grant.id, type="vest", event_date=date.today(), shares=Decimal("25"), fmv=Decimal("40")))
    assert event.est_tax["income_recognized"] == "1000.00"
    summary = await equity_summary(session, user)
    assert summary["vested_value"] == Decimal("1000.00")
    assert summary["grants"][0]["upcoming_vests"]
