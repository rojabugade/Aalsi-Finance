"""M34: password reset, email verification and MFA recovery codes.

SMTP is never contacted — app.email.messages is patched so the tests capture the
token that would have been mailed and then drive the confirm endpoints with it.

Skips when no Postgres is reachable, mirroring the other integration suites.
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone

import pyotp
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.auth import security, service
from app.db import get_session
from app.main import app
from app.models.core import AuthToken, MfaRecoveryCode, RefreshToken, User

TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://finance:finance@localhost:5433/finance",
)

HOUSEHOLD_PREFIX = "pytest-m34-"


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


@pytest.fixture
def outbox(monkeypatch):
    """Capture the messages the service would have mailed."""
    sent: list[dict] = []

    async def _reset(to, token, ttl_minutes):
        sent.append({"kind": "reset", "to": to, "token": token})

    async def _verify(to, token, ttl_hours):
        sent.append({"kind": "verify", "to": to, "token": token})

    async def _changed(to):
        sent.append({"kind": "changed", "to": to})

    monkeypatch.setattr(service.email_messages, "send_password_reset", _reset)
    monkeypatch.setattr(service.email_messages, "send_email_verification", _verify)
    monkeypatch.setattr(service.email_messages, "send_password_changed", _changed)
    return sent


async def _signup(client, name_suffix: str) -> tuple[str, str, str]:
    """Return (email, password, access_token)."""
    email, password = _email(), "hunter2pass"
    r = await client.post(
        "/auth/signup",
        json={
            "email": email,
            "password": password,
            "workspace_name": f"{HOUSEHOLD_PREFIX}{name_suffix}",
            "age_confirmed": True,
            "terms_accepted": True,
        },
    )
    assert r.status_code == 201, r.text
    return email, password, r.json()["access_token"]


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# --- Password reset ----------------------------------------------------------

@pytest.mark.asyncio
async def test_password_reset_replaces_password_and_kills_sessions(
    client, session_factory, outbox
):
    email, old_password, _ = await _signup(client, "reset")
    outbox.clear()

    r = await client.post("/auth/password-reset/request", json={"email": email})
    assert r.status_code == 202
    token = next(m["token"] for m in outbox if m["kind"] == "reset")

    r = await client.post(
        "/auth/password-reset/confirm",
        json={"token": token, "new_password": "brand-new-pass"},
    )
    assert r.status_code == 204

    # Old password rejected, new one works.
    r = await client.post("/auth/login", json={"email": email, "password": old_password})
    assert r.status_code == 401
    r = await client.post("/auth/login", json={"email": email, "password": "brand-new-pass"})
    assert r.status_code == 200

    # Every refresh token minted before the reset is revoked, so a stolen one is
    # useless afterwards. The login above adds one live token.
    async with session_factory() as s:
        user = (await s.execute(select(User).where(User.email == email))).scalar_one()
        rows = (
            await s.execute(select(RefreshToken).where(RefreshToken.user_id == user.id))
        ).scalars().all()
    assert sum(1 for row in rows if not row.revoked) == 1


@pytest.mark.asyncio
async def test_password_reset_token_is_single_use(client, outbox):
    email, _, _ = await _signup(client, "single-use")
    outbox.clear()

    await client.post("/auth/password-reset/request", json={"email": email})
    token = next(m["token"] for m in outbox if m["kind"] == "reset")

    first = await client.post(
        "/auth/password-reset/confirm", json={"token": token, "new_password": "first-pass-x"}
    )
    assert first.status_code == 204
    second = await client.post(
        "/auth/password-reset/confirm", json={"token": token, "new_password": "second-pass-x"}
    )
    assert second.status_code == 400


@pytest.mark.asyncio
async def test_password_reset_rejects_expired_token(client, session_factory, outbox):
    email, _, _ = await _signup(client, "expired")
    outbox.clear()

    await client.post("/auth/password-reset/request", json={"email": email})
    token = next(m["token"] for m in outbox if m["kind"] == "reset")

    async with session_factory() as s:
        row = (
            await s.execute(
                select(AuthToken).where(
                    AuthToken.token_hash == security.hash_auth_token(token)
                )
            )
        ).scalar_one()
        row.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        await s.commit()

    r = await client.post(
        "/auth/password-reset/confirm", json={"token": token, "new_password": "late-pass-x"}
    )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_password_reset_request_does_not_reveal_unknown_accounts(client, outbox):
    """An unregistered address must be indistinguishable from a registered one."""
    known, _, _ = await _signup(client, "enumeration")
    outbox.clear()

    hit = await client.post("/auth/password-reset/request", json={"email": known})
    miss = await client.post("/auth/password-reset/request", json={"email": _email()})

    assert hit.status_code == miss.status_code == 202
    assert hit.json() == miss.json()
    # ...while still only mailing the address that actually exists.
    assert [m["to"] for m in outbox if m["kind"] == "reset"] == [known]


# --- Email verification ------------------------------------------------------

@pytest.mark.asyncio
async def test_signup_sends_verification_and_confirm_marks_verified(client, outbox):
    outbox.clear()
    email, _, access = await _signup(client, "verify")

    me = await client.get("/auth/me", headers=_auth(access))
    assert me.status_code == 200
    assert me.json()["email_verified"] is False

    token = next(m["token"] for m in outbox if m["kind"] == "verify" and m["to"] == email)
    r = await client.post("/auth/verify-email/confirm", json={"token": token})
    assert r.status_code == 204

    me = await client.get("/auth/me", headers=_auth(access))
    assert me.json()["email_verified"] is True


@pytest.mark.asyncio
async def test_verification_token_of_wrong_purpose_is_rejected(client, outbox):
    """A reset token must not be redeemable as a verification token."""
    email, _, _ = await _signup(client, "purpose")
    outbox.clear()

    await client.post("/auth/password-reset/request", json={"email": email})
    reset_token = next(m["token"] for m in outbox if m["kind"] == "reset")

    r = await client.post("/auth/verify-email/confirm", json={"token": reset_token})
    assert r.status_code == 400


# --- MFA recovery codes ------------------------------------------------------

async def _enable_mfa(client, access: str) -> list[str]:
    enroll = await client.post("/auth/mfa/enroll", headers=_auth(access))
    assert enroll.status_code == 200, enroll.text
    secret = enroll.json()["secret"]
    verify = await client.post(
        "/auth/mfa/verify",
        json={"totp_code": pyotp.TOTP(secret).now()},
        headers=_auth(access),
    )
    assert verify.status_code == 200, verify.text
    return verify.json()["recovery_codes"]


@pytest.mark.asyncio
async def test_recovery_code_logs_in_and_is_consumed(client, outbox):
    email, password, access = await _signup(client, "recovery")
    codes = await _enable_mfa(client, access)
    assert len(codes) == 10

    # Without a second factor MFA blocks the login.
    blocked = await client.post("/auth/login", json={"email": email, "password": password})
    assert blocked.status_code == 401

    first = await client.post(
        "/auth/login", json={"email": email, "password": password, "totp_code": codes[0]}
    )
    assert first.status_code == 200

    # The same code cannot be replayed.
    replay = await client.post(
        "/auth/login", json={"email": email, "password": password, "totp_code": codes[0]}
    )
    assert replay.status_code == 401

    # A different code still works.
    second = await client.post(
        "/auth/login", json={"email": email, "password": password, "totp_code": codes[1]}
    )
    assert second.status_code == 200


@pytest.mark.asyncio
async def test_recovery_codes_are_accepted_case_and_dash_insensitively(client, outbox):
    email, password, access = await _signup(client, "format")
    codes = await _enable_mfa(client, access)

    typed = codes[0].lower().replace("-", "")
    r = await client.post(
        "/auth/login", json={"email": email, "password": password, "totp_code": typed}
    )
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_regenerating_recovery_codes_invalidates_the_old_batch(
    client, session_factory, outbox
):
    email, password, access = await _signup(client, "regen")
    old_codes = await _enable_mfa(client, access)

    r = await client.post("/auth/mfa/recovery-codes", headers=_auth(access))
    assert r.status_code == 200
    new_codes = r.json()["recovery_codes"]
    assert set(new_codes).isdisjoint(old_codes)

    stale = await client.post(
        "/auth/login", json={"email": email, "password": password, "totp_code": old_codes[0]}
    )
    assert stale.status_code == 401

    fresh = await client.post(
        "/auth/login", json={"email": email, "password": password, "totp_code": new_codes[0]}
    )
    assert fresh.status_code == 200

    async with session_factory() as s:
        user = (await s.execute(select(User).where(User.email == email))).scalar_one()
        rows = (
            await s.execute(
                select(MfaRecoveryCode).where(MfaRecoveryCode.user_id == user.id)
            )
        ).scalars().all()
    assert len(rows) == 10


@pytest.mark.asyncio
async def test_mfa_status_reports_remaining_codes(client, outbox):
    email, password, access = await _signup(client, "status")
    codes = await _enable_mfa(client, access)

    status_before = await client.get("/auth/mfa/status", headers=_auth(access))
    assert status_before.json() == {"mfa_enabled": True, "unused_recovery_codes": 10}

    await client.post(
        "/auth/login", json={"email": email, "password": password, "totp_code": codes[0]}
    )
    status_after = await client.get("/auth/mfa/status", headers=_auth(access))
    assert status_after.json()["unused_recovery_codes"] == 9


@pytest.mark.asyncio
async def test_recovery_codes_are_not_stored_in_plaintext(client, session_factory, outbox):
    email, _, access = await _signup(client, "hashed")
    codes = await _enable_mfa(client, access)

    async with session_factory() as s:
        user = (await s.execute(select(User).where(User.email == email))).scalar_one()
        stored = (
            await s.execute(
                select(MfaRecoveryCode.code_hash).where(MfaRecoveryCode.user_id == user.id)
            )
        ).scalars().all()

    assert set(stored).isdisjoint(codes)
    assert security.hash_recovery_code(codes[0]) in stored
