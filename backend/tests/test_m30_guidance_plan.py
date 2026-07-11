from __future__ import annotations

import asyncio
import os
import uuid
from datetime import date

import pytest
import pytest_asyncio
from pydantic import ValidationError
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.guidance import service
from app.guidance.schemas import GuidancePlanItemCreate, GuidancePlanItemUpdate
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


async def _household_users(session):
    household = Household(
        name=f"{HOUSEHOLD_PREFIX}{uuid.uuid4().hex[:8]}",
        base_currency="USD",
    )
    session.add(household)
    await session.flush()

    users = [
        User(
            household_id=household.id,
            email=f"{uuid.uuid4().hex}@example.com",
            password_hash="x",
            role="owner" if index == 0 else "member",
        )
        for index in range(2)
    ]
    session.add_all(users)
    await session.flush()
    return household, users[0], users[1]


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


@pytest.mark.asyncio
async def test_plan_service_create_deduplicates_only_open_items_and_filters_status(session):
    _household, user, _other_user = await _household_users(session)
    source_refs = [{"title": "IRS guidance", "source_url": "https://www.irs.gov/example"}]

    first = await service.create_plan_item(
        session,
        user,
        GuidancePlanItemCreate(
            domain="cross_border",
            title="  Review   annual remittance obligations ",
            rationale="Confirm current reporting rules.",
            due_date=date(2026, 8, 1),
            source_refs=source_refs,
            origin_thread_key="overview",
        ),
    )
    duplicate = await service.create_plan_item(
        session,
        user,
        GuidancePlanItemCreate(
            domain="cross_border",
            title="review annual REMITTANCE obligations",
        ),
    )

    assert duplicate.id == first.id
    assert first.title == "Review annual remittance obligations"

    completed = await service.update_plan_item(
        session,
        user,
        first.id,
        GuidancePlanItemUpdate(status="completed"),
    )
    replacement = await service.create_plan_item(
        session,
        user,
        GuidancePlanItemCreate(
            domain="cross_border",
            title="Review annual remittance obligations",
        ),
    )

    assert completed.status == "completed"
    assert replacement.id != first.id
    assert replacement.status == "open"
    dated = await service.create_plan_item(
        session,
        user,
        GuidancePlanItemCreate(
            domain="general",
            title="Confirm insurance coverage",
            due_date=date(2026, 7, 15),
        ),
    )
    assert [item.id for item in await service.list_plan_items(session, user, status="open")] == [
        dated.id,
        replacement.id,
    ]
    assert [item.id for item in await service.list_plan_items(session, user)] == [
        dated.id,
        replacement.id,
        first.id,
    ]


@pytest.mark.asyncio
async def test_plan_service_isolates_users_and_allows_explicit_null_updates(session):
    _household, user_a, user_b = await _household_users(session)
    item = await service.create_plan_item(
        session,
        user_a,
        GuidancePlanItemCreate(
            domain="general",
            title="Review emergency fund",
            rationale="Check the target amount.",
            due_date=date(2026, 9, 1),
        ),
    )

    assert await service.list_plan_items(session, user_b) == []
    with pytest.raises(service.NotFound, match="Plan item not found"):
        await service.update_plan_item(
            session,
            user_b,
            item.id,
            GuidancePlanItemUpdate(status="dismissed"),
        )
    with pytest.raises(service.NotFound, match="Plan item not found"):
        await service.update_plan_item(
            session,
            user_a,
            uuid.uuid4(),
            GuidancePlanItemUpdate(status="completed"),
        )

    updated = await service.update_plan_item(
        session,
        user_a,
        item.id,
        GuidancePlanItemUpdate(rationale=None, due_date=None),
    )
    assert updated.rationale is None
    assert updated.due_date is None


def test_plan_update_rejects_null_for_non_nullable_fields():
    omitted = GuidancePlanItemUpdate()
    assert omitted.model_fields_set == set()
    with pytest.raises(ValidationError):
        GuidancePlanItemUpdate(title=None)
    with pytest.raises(ValidationError):
        GuidancePlanItemUpdate(status=None)
    nullable = GuidancePlanItemUpdate(rationale=None, due_date=None)
    assert nullable.model_fields_set == {"rationale", "due_date"}

    schema = GuidancePlanItemUpdate.model_json_schema()
    assert "title" not in schema.get("required", [])
    assert "status" not in schema.get("required", [])
    assert {item.get("type") for item in schema["properties"]["title"].get("anyOf", [])} <= {
        "string"
    }
    assert {item.get("type") for item in schema["properties"]["status"].get("anyOf", [])} <= {
        "string"
    }


@pytest.mark.asyncio
async def test_plan_service_concurrent_duplicate_create_returns_one_open_item(engine, session):
    _household, user, _other_user = await _household_users(session)
    await session.commit()
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async def create(title: str):
        async with session_factory() as concurrent_session:
            return await service.create_plan_item(
                concurrent_session,
                user,
                GuidancePlanItemCreate(
                    domain="investment",
                    title=title,
                ),
            )

    first, second = await asyncio.gather(
        create("Review portfolio fees"),
        create("  review   PORTFOLIO fees "),
    )

    assert first.id == second.id
    assert len(await service.list_plan_items(session, user, status="open")) == 1
