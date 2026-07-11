from __future__ import annotations

import os
import uuid
from datetime import date

import pytest
import pytest_asyncio
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models.conversation import AnalystMessage, AnalystThread
from app.models.core import Household, User
from app.models.guidance import GuidancePlanItem

TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://finance:finance@localhost:5433/finance",
)
HOUSEHOLD_PREFIX = "pytest-m30-"


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
            text("DELETE FROM household WHERE name LIKE :prefix"),
            {"prefix": f"{HOUSEHOLD_PREFIX}%"},
        )
    await eng.dispose()


@pytest_asyncio.fixture
async def session(engine):
    async with async_sessionmaker(engine, expire_on_commit=False)() as db_session:
        yield db_session


@pytest.mark.asyncio
async def test_guidance_plan_item_and_analyst_message_payload_round_trip(session):
    household = Household(
        name=f"{HOUSEHOLD_PREFIX}{uuid.uuid4().hex[:8]}",
        base_currency="USD",
    )
    session.add(household)
    await session.flush()

    user = User(
        household_id=household.id,
        email=f"{uuid.uuid4().hex}@example.com",
        password_hash="x",
        role="owner",
    )
    session.add(user)
    await session.flush()

    source_refs = [
        {
            "title": "RBI Liberalised Remittance Scheme",
            "url": "https://www.rbi.org.in/example",
            "source_type": "govt",
            "effective_date": "2026-01-01",
        }
    ]
    plan_item = GuidancePlanItem(
        household_id=household.id,
        user_id=user.id,
        domain="cross_border",
        title="Review annual remittance obligations",
        rationale="Confirm the applicable rules before transferring funds.",
        status="open",
        due_date=date(2026, 8, 1),
        source_refs=source_refs,
        origin_thread_key="guidance:cross-border",
    )
    thread = AnalystThread(household_id=household.id, key="guidance:cross-border")
    session.add_all([plan_item, thread])
    await session.flush()

    message = AnalystMessage(
        thread_id=thread.id,
        role="analyst",
        text="Review the cited remittance guidance.",
        payload={"citations": []},
    )
    session.add(message)
    await session.commit()

    plan_item_id = plan_item.id
    message_id = message.id
    household_id = household.id
    user_id = user.id
    session.expunge_all()

    persisted_item = await session.scalar(
        select(GuidancePlanItem).where(GuidancePlanItem.id == plan_item_id)
    )
    persisted_message = await session.scalar(
        select(AnalystMessage).where(AnalystMessage.id == message_id)
    )

    assert persisted_item is not None
    assert persisted_item.household_id == household_id
    assert persisted_item.user_id == user_id
    assert persisted_item.domain == "cross_border"
    assert persisted_item.status == "open"
    assert persisted_item.due_date == date(2026, 8, 1)
    assert persisted_item.source_refs == source_refs
    assert persisted_message is not None
    assert persisted_message.payload == {"citations": []}
