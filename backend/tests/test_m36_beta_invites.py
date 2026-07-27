"""M36: closed-beta gate — applications, one-time invite codes, usage ceilings.

The invariant worth defending here is that a code is spent exactly once, and it
has to hold when two people submit the same code at the same instant, not just
when they take turns. `test_concurrent_redemption_lets_exactly_one_through`
drives two real transactions at one row; a read-then-write implementation passes
every other test in this file and fails that one.

Skips when no Postgres is reachable, mirroring the rest of the suite. Point at a
DB with `alembic upgrade head` applied via TEST_DATABASE_URL (compose port 5433).
"""

from __future__ import annotations

import asyncio
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.beta import service as beta_service
from app.beta.codes import generate_code, hash_code, normalize
from app.db import get_session
from app.main import app
from app.models.beta import BetaApplication, InviteCode
from app.models.core import Household, User

TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://finance:finance@localhost:5433/finance",
)

HOUSEHOLD_PREFIX = "pytest-m36-"
EMAIL_DOMAIN = "pytest-m36.example.com"


def _email() -> str:
    return f"{uuid.uuid4().hex[:12]}@{EMAIL_DOMAIN}"


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
        # Codes first: they reference both other tables.
        await conn.execute(
            text("DELETE FROM invite_code WHERE issued_to_email LIKE :p OR note = :n"),
            {"p": f"%@{EMAIL_DOMAIN}", "n": HOUSEHOLD_PREFIX},
        )
        await conn.execute(
            text("DELETE FROM beta_application WHERE email LIKE :p"),
            {"p": f"%@{EMAIL_DOMAIN}"},
        )
        await conn.execute(
            text("DELETE FROM household WHERE name LIKE :p"), {"p": f"{HOUSEHOLD_PREFIX}%"}
        )
    await eng.dispose()


@pytest_asyncio.fixture
async def session_factory(engine):
    return async_sessionmaker(bind=engine, expire_on_commit=False)


@pytest_asyncio.fixture
async def client(session_factory):
    async def _override():
        async with session_factory() as s:
            yield s

    app.dependency_overrides[get_session] = _override
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        yield ac
    app.dependency_overrides.pop(get_session, None)


@pytest.fixture
def gate_on(monkeypatch):
    """Turn the invite gate on for one test.

    `app.auth.service` binds `settings` at import, so patching the cached
    Settings object is what the running code actually reads.
    """
    from app.auth import service as auth_service

    monkeypatch.setattr(auth_service.settings, "beta_invite_required", True, raising=True)
    return True


async def _signup(client: AsyncClient, code: str | None = None, **overrides):
    body = {
        "email": _email(),
        "password": "correct horse battery staple",
        "workspace_name": f"{HOUSEHOLD_PREFIX}{uuid.uuid4().hex[:8]}",
        "age_confirmed": True,
        "terms_accepted": True,
        **overrides,
    }
    if code is not None:
        body["invite_code"] = code
    return await client.post("/auth/signup", json=body)


# --- codes (pure, no database) ------------------------------------------------

def test_normalize_forgives_how_a_code_was_typed():
    code = generate_code()
    assert normalize(code.lower()) == normalize(code)
    assert normalize(code.replace("-", " ")) == normalize(code)
    assert normalize(f"  {code}  ") == normalize(code)
    assert hash_code(code.lower().replace("-", "")) == hash_code(code)


def test_generated_codes_are_distinct_and_shaped():
    codes = {generate_code() for _ in range(200)}
    assert len(codes) == 200
    for code in codes:
        prefix, *groups = code.split("-")
        assert prefix == "ALSI"
        assert [len(group) for group in groups] == [5, 5, 5]
        # No glyph anyone has to squint at.
        assert not set("".join(groups)) & set("ILOU01")


# --- applications -------------------------------------------------------------

@pytest.mark.asyncio
async def test_apply_records_and_is_idempotent(client, session_factory):
    email = _email()
    payload = {
        "email": email,
        "name": "Sam",
        "country": "us",
        "how_you_track_money": "A spreadsheet I stopped updating in March.",
    }

    first = await client.post("/beta/apply", json=payload)
    assert first.status_code == 202
    assert first.json() == {"status": "received"}

    # Re-applying must not 409, and must not create a second row.
    second = await client.post("/beta/apply", json={**payload, "name": "Samantha"})
    assert second.status_code == 202
    assert second.json() == first.json()

    async with session_factory() as session:
        rows = (
            await session.execute(
                select(BetaApplication).where(BetaApplication.email == email)
            )
        ).scalars().all()

    assert len(rows) == 1
    assert rows[0].status == "pending"
    assert rows[0].country == "US"
    assert rows[0].name == "Samantha"


@pytest.mark.asyncio
async def test_minting_marks_the_application_invited(client, session_factory):
    email = _email()
    await client.post("/beta/apply", json={"email": email})

    async with session_factory() as session:
        codes = await beta_service.mint_codes(session, count=2, email=email, note=HOUSEHOLD_PREFIX)

    assert len(codes) == 2
    async with session_factory() as session:
        application = (
            await session.execute(
                select(BetaApplication).where(BetaApplication.email == email)
            )
        ).scalar_one()
        assert application.status == "invited"
        assert application.invited_at is not None

        stored = (
            await session.execute(
                select(InviteCode).where(InviteCode.application_id == application.id)
            )
        ).scalars().all()

    assert len(stored) == 2
    # The plaintext must not be recoverable from the row.
    assert {row.code_hash for row in stored} == {hash_code(code) for code in codes}
    assert not any(normalize(code) in row.code_hash for row in stored for code in codes)


# --- redemption ---------------------------------------------------------------

@pytest.mark.asyncio
async def test_signup_requires_a_code_while_the_gate_is_up(client, gate_on):
    response = await _signup(client)
    assert response.status_code == 400

    response = await _signup(client, code="ALSI-AAAAA-AAAAA-AAAAA")
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_a_code_works_once(client, session_factory, gate_on):
    async with session_factory() as session:
        code, = await beta_service.mint_codes(session, count=1, note=HOUSEHOLD_PREFIX)

    first = await _signup(client, code=code)
    assert first.status_code == 201, first.text

    second = await _signup(client, code=code)
    assert second.status_code == 400
    assert "already used" in second.json()["detail"]

    async with session_factory() as session:
        row = (
            await session.execute(
                select(InviteCode).where(InviteCode.code_hash == hash_code(code))
            )
        ).scalar_one()
        assert row.redeemed_at is not None
        assert row.redeemed_by_user_id is not None


@pytest.mark.asyncio
async def test_expired_codes_are_refused(client, session_factory, gate_on):
    async with session_factory() as session:
        code, = await beta_service.mint_codes(session, count=1, note=HOUSEHOLD_PREFIX)
        await session.execute(
            InviteCode.__table__.update()
            .where(InviteCode.code_hash == hash_code(code))
            .values(expires_at=datetime.now(timezone.utc) - timedelta(minutes=1))
        )
        await session.commit()

    assert (await _signup(client, code=code)).status_code == 400


@pytest.mark.asyncio
async def test_gate_down_lets_signup_through_without_a_code(client):
    # No `gate_on` fixture: conftest leaves BETA_INVITE_REQUIRED false.
    assert (await _signup(client)).status_code == 201


@pytest.mark.asyncio
async def test_concurrent_redemption_lets_exactly_one_through(session_factory):
    """Two transactions, one code, at the same time. Exactly one may win.

    This is the test a SELECT-then-UPDATE implementation fails: both reads would
    see `redeemed_at IS NULL` and both would proceed.
    """
    async with session_factory() as session:
        code, = await beta_service.mint_codes(session, count=1, note=HOUSEHOLD_PREFIX)

        household = Household(name=f"{HOUSEHOLD_PREFIX}race", base_currency="USD")
        session.add(household)
        await session.flush()
        users = [
            User(household_id=household.id, email=_email(), password_hash="x")
            for _ in range(2)
        ]
        session.add_all(users)
        await session.commit()
        user_ids = [user.id for user in users]

    async def attempt(user_id: uuid.UUID) -> bool:
        async with session_factory() as session:
            try:
                await beta_service.redeem_code(session, code, user_id)
                await session.commit()
                return True
            except Exception:  # noqa: BLE001 — a refusal is the expected outcome
                await session.rollback()
                return False

    results = await asyncio.gather(*(attempt(user_id) for user_id in user_ids))
    assert sum(results) == 1, f"expected exactly one redemption, got {results}"


# --- status and usage ---------------------------------------------------------

@pytest.mark.asyncio
async def test_status_reports_the_gate(client):
    response = await client.get("/beta/status")
    assert response.status_code == 200
    assert response.json() == {"invite_required": False}


@pytest.mark.asyncio
async def test_usage_needs_authentication(client):
    assert (await client.get("/beta/usage")).status_code in (401, 403)


@pytest.mark.asyncio
async def test_usage_reports_the_allowance(client, session_factory, monkeypatch):
    from app.beta import limits

    signup = await _signup(client)
    assert signup.status_code == 201
    token = signup.json()["access_token"]

    settings = limits.get_settings()
    monkeypatch.setattr(settings, "beta_limit_ai_requests_per_day", 40, raising=True)
    monkeypatch.setattr(settings, "beta_limit_documents_per_day", 25, raising=True)

    response = await client.get(
        "/beta/usage", headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 200
    body = response.json()

    assert body["active"] is True
    assert body["ai_requests"] == {
        "used": 0,
        "limit": 40,
        "remaining": 40,
        "next_credit_at": None,
    }
    assert body["documents"]["limit"] == 25

    # With every ceiling off, the client is told there is nothing to show.
    monkeypatch.setattr(settings, "beta_limit_ai_requests_per_day", 0, raising=True)
    monkeypatch.setattr(settings, "beta_limit_documents_per_day", 0, raising=True)
    off = await client.get("/beta/usage", headers={"Authorization": f"Bearer {token}"})
    assert off.json()["active"] is False


@pytest.mark.asyncio
async def test_ai_quota_refuses_once_spent(client, session_factory, monkeypatch):
    from app.beta import limits
    from app.models.core import LLMUsageLog

    signup = await _signup(client)
    assert signup.status_code == 201
    token = signup.json()["access_token"]

    async with session_factory() as session:
        user = (
            await session.execute(
                select(User).where(User.email.like(f"%@{EMAIL_DOMAIN}"))
                .order_by(User.created_at.desc())
            )
        ).scalars().first()
        user_id = user.id
        for _ in range(3):
            session.add(
                LLMUsageLog(user_id=user_id, provider="test", model="test", purpose="ask")
            )
        await session.commit()

    settings = limits.get_settings()
    monkeypatch.setattr(settings, "beta_limit_ai_requests_per_day", 3, raising=True)
    monkeypatch.setattr(settings, "beta_limit_ai_requests_per_minute", 0, raising=True)

    async with session_factory() as session:
        allowance = await limits.ai_allowance(session, user_id)
        assert allowance.used == 3
        assert allowance.remaining == 0
        assert allowance.exhausted
        assert allowance.next_credit_at is not None

    response = await client.post(
        "/analyst/ask",
        headers={"Authorization": f"Bearer {token}"},
        json={"mode": "general", "question": "where did the money go?"},
    )
    assert response.status_code == 429
    assert "AI requests" in response.json()["detail"]


@pytest.mark.asyncio
async def test_question_length_is_bounded(client):
    signup = await _signup(client)
    token = signup.json()["access_token"]
    response = await client.post(
        "/analyst/ask",
        headers={"Authorization": f"Bearer {token}"},
        json={"mode": "general", "question": "x" * 4001},
    )
    assert response.status_code == 422
