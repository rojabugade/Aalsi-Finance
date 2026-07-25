"""M2 done-condition test.

Exercises the full flow against the live schema: a user signs up (creating one
private workspace), enables TOTP MFA, logs in with a code, and we assert
refresh-token rotation/reuse detection plus the tenant-isolation query rule.

Skips when no Postgres is reachable, mirroring test_m1_schema. Point at a DB with
`alembic upgrade head` applied via TEST_DATABASE_URL (defaults to compose port 5433).
"""

from __future__ import annotations

import os
import uuid
from datetime import date
from decimal import Decimal

import pyotp
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.auth.deps import scoped_query
from app.db import get_session
from app.main import app
from app.models.core import Household, User
from app.models.transactions import Transaction

TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://finance:finance@localhost:5433/finance",
)

HOUSEHOLD_PREFIX = "pytest-m2-"


def _email() -> str:
    return f"{uuid.uuid4().hex[:12]}@example.com"


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
    # Cascade-delete everything this run created.
    async with eng.begin() as conn:
        await conn.execute(
            text("DELETE FROM household WHERE name LIKE :p"),
            {"p": f"{HOUSEHOLD_PREFIX}%"},
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
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _signup(client, workspace_name: str) -> tuple[dict, str]:
    email = _email()
    r = await client.post(
        "/auth/signup",
        json={
            "email": email,
            "password": "hunter2pass",
            "display_name": "Owner",
            "workspace_name": workspace_name,
        },
    )
    assert r.status_code == 201, r.text
    return r.json(), email


@pytest.mark.asyncio
async def test_signup_login_and_mfa_flow(client, session_factory):
    # 1. Signup -> private workspace + one account + tokens.
    tokens, owner_email = await _signup(client, f"{HOUSEHOLD_PREFIX}alpha")
    access = tokens["access_token"]

    me = await client.get("/workspace", headers=_auth(access))
    assert me.status_code == 200
    assert me.json()["name"] == f"{HOUSEHOLD_PREFIX}alpha"

    # 2. Enroll + enable MFA.
    enroll = await client.post("/auth/mfa/enroll", headers=_auth(access))
    assert enroll.status_code == 200
    secret = enroll.json()["secret"]
    code = pyotp.TOTP(secret).now()
    verify = await client.post(
        "/auth/mfa/verify", headers=_auth(access), json={"totp_code": code}
    )
    # Enabling MFA hands back the one-time recovery codes (see test_m34).
    assert verify.status_code == 200
    assert len(verify.json()["recovery_codes"]) == 10

    # 3. Login now requires the TOTP code.
    bad = await client.post(
        "/auth/login", json={"email": owner_email, "password": "hunter2pass"}
    )
    assert bad.status_code == 401
    good = await client.post(
        "/auth/login",
        json={
            "email": owner_email,
            "password": "hunter2pass",
            "totp_code": pyotp.TOTP(secret).now(),
        },
    )
    assert good.status_code == 200

    # 4. The old public household surface is gone; workspace is read-only except
    # its explicit base-currency endpoint.
    for path in ("/household/invite", "/household", "/household/join", "/workspace/invite"):
        gone = await client.post(path, headers=_auth(access), json={})
        assert gone.status_code == 404, f"POST {path} -> {gone.status_code}"


@pytest.mark.asyncio
async def test_refresh_rotation_and_reuse_detection(client):
    # The refresh token is delivered only as an httpOnly cookie — the SPA never sees
    # it. httpx (not a browser) exposes it via the cookie jar so the test can drive
    # rotation/reuse. /auth/refresh requires the double-submit CSRF header.
    await _signup(client, f"{HOUSEHOLD_PREFIX}rotate")
    first_refresh = client.cookies.get("cbf_refresh")
    csrf = client.cookies.get("cbf_csrf")
    assert first_refresh and csrf
    hdr = {"X-CSRF-Token": csrf}

    # Missing CSRF header is rejected even with a valid cookie.
    no_csrf = await client.post("/auth/refresh")
    assert no_csrf.status_code == 403

    r1 = await client.post("/auth/refresh", headers=hdr)  # jar sends the refresh cookie
    assert r1.status_code == 200, r1.text
    assert "refresh_token" not in r1.json()  # never leaked into the body
    second_refresh = client.cookies.get("cbf_refresh")
    assert second_refresh != first_refresh

    # Reusing the rotated (now revoked) token is rejected...
    client.cookies.clear()
    reuse = await client.post("/auth/refresh", headers=hdr, cookies={"cbf_refresh": first_refresh, "cbf_csrf": csrf})
    assert reuse.status_code == 401

    # ...and reuse detection burned the whole chain, so the new one is dead too.
    client.cookies.clear()
    after = await client.post("/auth/refresh", headers=hdr, cookies={"cbf_refresh": second_refresh, "cbf_csrf": csrf})
    assert after.status_code == 401


@pytest.mark.asyncio
async def test_scoped_query_workspace_isolation(session_factory):
    """Private workspaces never return another account's records."""
    async with session_factory() as s:
        first = Household(name=f"{HOUSEHOLD_PREFIX}scope-a", base_currency="USD")
        second = Household(name=f"{HOUSEHOLD_PREFIX}scope-b", base_currency="USD")
        s.add_all([first, second])
        await s.flush()
        account_a = User(household_id=first.id, email=_email(), password_hash="x")
        account_b = User(household_id=second.id, email=_email(), password_hash="x")
        s.add_all([account_a, account_b])
        await s.flush()

        def _txn(household_id, owner_id):
            return Transaction(
                household_id=household_id,
                owner_user_id=owner_id,
                amount=Decimal("10.00"),
                currency="USD",
                txn_date=date(2026, 1, 1),
            )

        mine = _txn(first.id, account_a.id)
        foreign = _txn(second.id, account_b.id)
        s.add_all([mine, foreign])
        await s.flush()

        rows = (await s.execute(scoped_query(Transaction, account_a))).scalars().all()
        ids = {r.id for r in rows}
        assert mine.id in ids
        assert foreign.id not in ids

        await s.rollback()
