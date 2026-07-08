from __future__ import annotations

import os
import uuid
from datetime import date
from decimal import Decimal

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.guidance.schemas import CrossBorderTransferIn, GuidanceAskIn, GuidanceWizardIn
from app.guidance.service import ask_guidance, create_transfer, limits, wizard
from app.models.core import Household, User
from app.models.guidance import GuidanceDoc, Notification

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL", "postgresql+asyncpg://finance:finance@localhost:5433/finance")
HOUSEHOLD_PREFIX = "pytest-m10-"


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
        await conn.execute(text("DELETE FROM guidance_doc WHERE title LIKE 'pytest-m10-%'"))
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
    session.add(GuidanceDoc(country="IN", topic="remittance limits", title="pytest-m10-India LRS", body="limit_amount: 250000\nlimit_currency: USD\nlimit_period: financial year\nLRS applies to resident outward remittance.", source_url="https://rbi.example", source_type="govt", effective_date=date(2026, 1, 1)))
    session.add(GuidanceDoc(country="US", topic="investment education", title="pytest-m10-Community investing", body="Community consensus favors diversification and low costs.", source_url="https://community.example", source_type="community", effective_date=date(2026, 1, 1)))
    await session.commit()
    return user


@pytest.mark.asyncio
async def test_guidance_answer_wizard_and_limits(session):
    user = await _user(session)
    answer = await ask_guidance(session, user, GuidanceAskIn(question="What should I know about India remittance limits?", country="IN"), llm=None)
    assert answer["citations"][0]["source_type"] == "govt"
    assert "not financial" in answer["disclaimer"]

    wiz = await wizard(session, user, GuidanceWizardIn(countries=["IN", "US"], annual_transfer_amount=Decimal("1000"), transfer_currency="USD"))
    assert wiz["checklist"]
    assert (await session.get(Notification, (await session.execute(text("SELECT id FROM notification WHERE household_id=:h LIMIT 1"), {"h": user.household_id})).scalar_one())) is not None

    await create_transfer(session, user, CrossBorderTransferIn(direction="out", from_currency="USD", to_currency="INR", amount=Decimal("210000"), fx_rate=Decimal("83.0"), transfer_date=date.today()))
    out = await limits(session, user)
    assert out["limits"][0]["amount"] == "250000"
    assert out["warnings"]
