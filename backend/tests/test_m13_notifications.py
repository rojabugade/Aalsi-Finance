from __future__ import annotations

import os
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.auth.deps import get_current_user
from app.db import get_session
from app.models.core import Household, User
from app.models.debt import Loan, PaymentSchedule
from app.models.documents import Document
from app.models.fx import CrossBorderTransfer
from app.models.guidance import Notification
from app.models.transactions import Budget, Transaction
from app.notifications import service
from app.notifications.router import router as notifications_router

TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://finance:finance@localhost:5433/finance",
)

HOUSEHOLD_PREFIX = "pytest-m13-"


@pytest_asyncio.fixture
async def engine():
    eng = create_async_engine(TEST_DATABASE_URL)
    try:
        async with eng.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception as exc:  # noqa: BLE001
        await eng.dispose()
        pytest.skip(f"no Postgres at {TEST_DATABASE_URL}: {exc}")
    async with eng.begin() as conn:
        await conn.execute(text("DELETE FROM household WHERE name LIKE :p"), {"p": f"{HOUSEHOLD_PREFIX}%"})
    yield eng
    async with eng.begin() as conn:
        await conn.execute(text("DELETE FROM household WHERE name LIKE :p"), {"p": f"{HOUSEHOLD_PREFIX}%"})
    await eng.dispose()


@pytest_asyncio.fixture
async def session_factory(engine):
    return async_sessionmaker(bind=engine, expire_on_commit=False)


@pytest_asyncio.fixture
async def session(session_factory):
    async with session_factory() as s:
        yield s


def _email() -> str:
    return f"{uuid.uuid4().hex[:12]}@example.com"


async def _user(session) -> User:
    hh = Household(name=f"{HOUSEHOLD_PREFIX}{uuid.uuid4().hex[:8]}", base_currency="USD")
    session.add(hh)
    await session.flush()
    user = User(
        household_id=hh.id,
        email=_email(),
        password_hash="x",
    )
    session.add(user)
    await session.flush()
    return user


@pytest.mark.asyncio
async def test_notification_center_preferences_and_read_endpoint(session_factory):
    async with session_factory() as s:
        user = await _user(s)
        await s.commit()

    api = FastAPI()
    api.include_router(notifications_router)

    async def _session_override():
        async with session_factory() as s:
            yield s

    async def _current_user_override():
        async with session_factory() as s:
            return (await s.execute(select(User).where(User.id == user.id))).scalar_one()

    api.dependency_overrides[get_session] = _session_override
    api.dependency_overrides[get_current_user] = _current_user_override
    transport = ASGITransport(app=api)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        prefs = await client.get("/notifications/preferences")
        assert prefs.status_code == 200
        assert prefs.json()["channels"]["inapp"] is True

        patched = await client.patch(
            "/notifications/preferences",
            json={"channels": {"email": True}, "quiet_hours": {"enabled": True, "start": "22:00", "end": "07:00", "timezone": "UTC"}},
        )
        assert patched.status_code == 200, patched.text
        assert patched.json()["channels"]["email"] is True
        assert patched.json()["quiet_hours"]["enabled"] is True

        async with session_factory() as s:
            await service.enqueue_notification(
                s,
                household_id=user.household_id,
                user_id=user.id,
                type="api_notice",
                payload={"message": "hello"},
                scheduled_for=datetime.now(timezone.utc),
                channels=["inapp"],
                idempotency_key="api_notice",
            )
            await s.commit()

        listed = await client.get("/notifications")
        assert listed.status_code == 200, listed.text
        note = listed.json()[0]
        assert note["type"] == "api_notice"

        read = await client.post(f"/notifications/{note['id']}/read")
        assert read.status_code == 200, read.text
        assert read.json()["status"] == "read"


@pytest.mark.asyncio
async def test_enqueue_dispatch_respects_preferences_and_quiet_hours(session):
    user = await _user(session)

    created = await service.enqueue_notification(
        session,
        household_id=user.household_id,
        user_id=user.id,
        type="payment_notice",
        payload={"n": 1},
        scheduled_for=datetime.now(timezone.utc),
        channels=["inapp", "email"],
        idempotency_key="payment_notice:1",
    )
    await session.commit()
    assert [n.channel for n in created] == ["inapp"]

    first_dispatch = await service.dispatch_due_notifications(session)
    assert first_dispatch["sent"] == 1
    assert (await session.get(Notification, created[0].id)).status == "sent"

    user.notification_preferences = {
        "channels": {"inapp": True, "email": True, "push": False, "bot": False},
        "quiet_hours": {"enabled": True, "start": "00:00", "end": "23:59", "timezone": "UTC"},
        "types": {},
    }
    created = await service.enqueue_notification(
        session,
        household_id=user.household_id,
        user_id=user.id,
        type="quiet_notice",
        payload={"n": 2},
        scheduled_for=datetime.now(timezone.utc),
        channels=["inapp", "email"],
        idempotency_key="quiet_notice:2",
    )
    await session.commit()
    assert {n.channel for n in created} == {"inapp", "email"}

    quiet_dispatch = await service.dispatch_due_notifications(session)
    assert quiet_dispatch["deferred"] == 2
    statuses = {(await session.get(Notification, n.id)).channel: (await session.get(Notification, n.id)).status for n in created}
    assert statuses == {"inapp": "pending", "email": "pending"}


@pytest.mark.asyncio
async def test_scheduler_scans_sources_and_is_idempotent(session):
    user = await _user(session)
    today = date.today()
    now = datetime.now(timezone.utc)

    loan = Loan(
        household_id=user.household_id,
        owner_user_id=user.id,
        name="Due soon",
        type="personal",
        schedule_kind="emi",
        principal=Decimal("1000.00"),
        currency="USD",
        interest_rate=Decimal("12.00"),
        compounding="monthly",
        min_or_emi_amount=Decimal("100.00"),
        due_day=(today + timedelta(days=2)).day,
        penalty_rules={"late_fee": "25", "warning_days": 7},
        start_date=today,
    )
    session.add(loan)
    await session.flush()
    session.add(
        PaymentSchedule(
            loan_id=loan.id,
            installment_no=1,
            due_date=today + timedelta(days=2),
            principal_component=Decimal("90.00"),
            interest_component=Decimal("10.00"),
            balance_after=Decimal("910.00"),
            status="due",
        )
    )
    budget = Budget(household_id=user.household_id, period="monthly", amount=Decimal("50.00"), currency="USD")
    session.add(budget)
    session.add(
        Transaction(
            household_id=user.household_id,
            owner_user_id=user.id,
            amount=Decimal("75.00"),
            currency="USD",
            base_amount=Decimal("75.00"),
            txn_date=today,
            status="confirmed",
        )
    )
    document = Document(
        household_id=user.household_id,
        uploaded_by_user_id=user.id,
        storage_key="test/key",
        type="receipt",
        source_channel="upload",
        status="needs_review",
        ocr_meta={},
    )
    document.created_at = now - timedelta(days=2)
    session.add(document)
    transfer = CrossBorderTransfer(
        household_id=user.household_id,
        owner_user_id=user.id,
        direction="out",
        from_currency="USD",
        to_currency="INR",
        amount=Decimal("1000.00"),
        fx_rate=Decimal("83.00000000"),
        purpose="family support",
        channel="bank",
        transfer_date=today,
    )
    session.add(transfer)
    await session.commit()

    first = await service.scan_and_enqueue_reminders(session, now=now)
    assert first == {
        "loan_due": 1,
        "loan_penalty_risk": 1,
        "budget_overspend": 1,
        "document_review": 1,
        "cross_border_reminder": 1,
    }
    second = await service.scan_and_enqueue_reminders(session, now=now)
    assert second == {
        "loan_due": 0,
        "loan_penalty_risk": 0,
        "budget_overspend": 0,
        "document_review": 0,
        "cross_border_reminder": 0,
    }
    dispatch = await service.dispatch_due_notifications(session)
    assert dispatch["sent"] == 5
    third = await service.scan_and_enqueue_reminders(session, now=now)
    assert third == {
        "loan_due": 0,
        "loan_penalty_risk": 0,
        "budget_overspend": 0,
        "document_review": 0,
        "cross_border_reminder": 0,
    }
    assert await session.scalar(select(func.count()).select_from(Notification).where(Notification.household_id == user.household_id)) == 5
