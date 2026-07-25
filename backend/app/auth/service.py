"""Auth & household business logic. Routers stay thin; this holds the rules.

Refresh tokens rotate on every use: the presented token is revoked and a fresh one
issued. Presenting an already-revoked token is treated as theft — every refresh token
for that user is revoked (reuse detection).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

import structlog

from app.auth import security
from app.auth.schemas import SignupIn
from app.config import get_settings
from app.email import messages as email_messages
from app.email.sender import EmailNotConfigured
from app.fx.service import normalize_currency
from app.models.core import (
    AuditLog,
    AuthToken,
    Household,
    MfaRecoveryCode,
    RefreshToken,
    User,
)

settings = get_settings()
log = structlog.get_logger()


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _get_user_by_email(session: AsyncSession, email: str) -> User | None:
    res = await session.execute(select(User).where(User.email == email.lower()))
    return res.scalar_one_or_none()


async def _issue_tokens(session: AsyncSession, user: User) -> tuple[str, str]:
    """Mint an access token and a persisted (hashed) refresh token."""
    access = security.create_access_token(user.id, user.household_id)
    raw_refresh, token_hash = security.new_refresh_token()
    session.add(
        RefreshToken(
            user_id=user.id,
            token_hash=token_hash,
            expires_at=_now() + timedelta(days=settings.refresh_token_ttl_days),
        )
    )
    return access, raw_refresh


async def _audit(
    session: AsyncSession,
    household_id: uuid.UUID,
    actor_user_id: uuid.UUID | None,
    action: str,
    entity: str | None = None,
) -> None:
    session.add(
        AuditLog(
            household_id=household_id,
            actor_user_id=actor_user_id,
            action=action,
            entity=entity,
        )
    )


# --- Signup / login ----------------------------------------------------------

async def signup(session: AsyncSession, data: SignupIn) -> tuple[str, str]:
    if await _get_user_by_email(session, data.email):
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")

    household = Household(
        name=data.workspace_name or data.display_name or data.email,
        base_currency=data.base_currency.upper(),
    )
    session.add(household)
    await session.flush()  # populate household.id

    user = User(
        household_id=household.id,
        email=data.email.lower(),
        password_hash=security.hash_password(data.password),
        display_name=data.display_name,
    )
    session.add(user)
    await session.flush()

    await _audit(session, household.id, user.id, "account.create", "user")
    tokens = await _issue_tokens(session, user)
    await session.commit()
    # Best-effort: an unreachable mail server must not fail the signup itself.
    await request_email_verification(session, user)
    return tokens


async def login(
    session: AsyncSession, email: str, password: str, totp_code: str | None
) -> tuple[str, str]:
    user = await _get_user_by_email(session, email)
    # Constant-ish failure path; don't reveal which factor failed.
    if user is None or not security.verify_password(password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Account disabled")

    if user.mfa_enabled:
        if not totp_code:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or missing MFA code")
        totp_ok = bool(user.mfa_secret) and security.verify_totp(user.mfa_secret, totp_code)
        # A recovery code stands in for the authenticator app and is burned on use.
        if not totp_ok and not await _consume_recovery_code(session, user, totp_code):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or missing MFA code")

    tokens = await _issue_tokens(session, user)
    await session.commit()
    return tokens


async def _consume_recovery_code(session: AsyncSession, user: User, code: str) -> bool:
    """Redeem an unused recovery code, returning whether one matched."""
    code_hash = security.hash_recovery_code(code)
    res = await session.execute(
        select(MfaRecoveryCode).where(
            MfaRecoveryCode.user_id == user.id,
            MfaRecoveryCode.code_hash == code_hash,
            MfaRecoveryCode.used_at.is_(None),
        )
    )
    row = res.scalar_one_or_none()
    if row is None:
        return False
    row.used_at = _now()
    await _audit(session, user.household_id, user.id, "mfa.recovery_code_used", "user")
    return True


async def refresh(session: AsyncSession, raw_refresh: str) -> tuple[str, str]:
    token_hash = security.hash_refresh_token(raw_refresh)
    res = await session.execute(
        select(RefreshToken).where(RefreshToken.token_hash == token_hash)
    )
    row = res.scalar_one_or_none()

    if row is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid refresh token")

    if row.revoked:
        # Reuse of a rotated token => compromise. Burn every session for this user.
        await session.execute(
            update(RefreshToken)
            .where(RefreshToken.user_id == row.user_id)
            .values(revoked=True)
        )
        await session.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Refresh token reuse detected")

    if row.expires_at <= _now():
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Refresh token expired")

    row.revoked = True  # rotate
    user = await session.get(User, row.user_id)
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid refresh token")

    tokens = await _issue_tokens(session, user)
    await session.commit()
    return tokens


async def logout(session: AsyncSession, raw_refresh: str) -> None:
    token_hash = security.hash_refresh_token(raw_refresh)
    await session.execute(
        update(RefreshToken)
        .where(RefreshToken.token_hash == token_hash)
        .values(revoked=True)
    )
    await session.commit()


# --- MFA ---------------------------------------------------------------------

async def mfa_enroll(session: AsyncSession, user: User) -> tuple[str, str]:
    secret = security.new_totp_secret()
    user.mfa_secret = secret
    user.mfa_enabled = False  # not active until a code is verified
    await session.commit()
    return secret, security.totp_provisioning_uri(secret, user.email)


async def mfa_verify(session: AsyncSession, user: User, code: str) -> list[str]:
    """Activate MFA and return a fresh batch of recovery codes.

    The codes are returned exactly once — only their hashes are kept — so the
    caller must show them to the user before the response is discarded.
    """
    if not user.mfa_secret:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "MFA not enrolled")
    if not security.verify_totp(user.mfa_secret, code):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid MFA code")
    user.mfa_enabled = True
    codes = await _issue_recovery_codes(session, user)
    await _audit(session, user.household_id, user.id, "mfa.enable", "user")
    await session.commit()
    return codes


async def _issue_recovery_codes(session: AsyncSession, user: User) -> list[str]:
    """Replace any existing codes with a new batch. Caller commits."""
    await session.execute(
        delete(MfaRecoveryCode).where(MfaRecoveryCode.user_id == user.id)
    )
    codes: list[str] = []
    for _ in range(settings.mfa_recovery_code_count):
        code, code_hash = security.new_recovery_code()
        codes.append(code)
        session.add(MfaRecoveryCode(user_id=user.id, code_hash=code_hash))
    return codes


async def regenerate_recovery_codes(session: AsyncSession, user: User) -> list[str]:
    if not user.mfa_enabled:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "MFA is not enabled")
    codes = await _issue_recovery_codes(session, user)
    await _audit(session, user.household_id, user.id, "mfa.recovery_codes_regenerated", "user")
    await session.commit()
    return codes


async def count_unused_recovery_codes(session: AsyncSession, user: User) -> int:
    res = await session.execute(
        select(func.count())
        .select_from(MfaRecoveryCode)
        .where(MfaRecoveryCode.user_id == user.id, MfaRecoveryCode.used_at.is_(None))
    )
    return int(res.scalar_one())


# --- Emailed tokens ----------------------------------------------------------

async def _issue_auth_token(
    session: AsyncSession, user: User, purpose: str, ttl: timedelta
) -> str:
    """Invalidate outstanding tokens of this purpose and mint a new one."""
    await session.execute(
        update(AuthToken)
        .where(
            AuthToken.user_id == user.id,
            AuthToken.purpose == purpose,
            AuthToken.used_at.is_(None),
        )
        .values(used_at=_now())
    )
    raw, token_hash = security.new_auth_token()
    session.add(
        AuthToken(
            user_id=user.id,
            purpose=purpose,
            token_hash=token_hash,
            expires_at=_now() + ttl,
        )
    )
    return raw


async def _redeem_auth_token(session: AsyncSession, raw: str, purpose: str) -> User:
    """Consume a token, raising 400 unless it is unused, unexpired and correct."""
    res = await session.execute(
        select(AuthToken).where(
            AuthToken.token_hash == security.hash_auth_token(raw),
            AuthToken.purpose == purpose,
        )
    )
    row = res.scalar_one_or_none()
    if row is None or row.used_at is not None or row.expires_at <= _now():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid or expired token")
    user = await session.get(User, row.user_id)
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid or expired token")
    row.used_at = _now()
    return user


# --- Password reset ----------------------------------------------------------

async def request_password_reset(session: AsyncSession, email: str) -> None:
    """Send a reset link if the address is known.

    Always returns normally. Reporting whether an address exists would turn this
    endpoint into an account-enumeration oracle, so an unknown address, an
    inactive account and a delivery failure are indistinguishable to the caller.
    """
    user = await _get_user_by_email(session, email)
    if user is None or not user.is_active:
        log.info("auth.password_reset_requested_unknown_email")
        return

    ttl_minutes = settings.password_reset_ttl_minutes
    raw = await _issue_auth_token(
        session, user, "password_reset", timedelta(minutes=ttl_minutes)
    )
    await _audit(session, user.household_id, user.id, "password.reset_requested", "user")
    await session.commit()

    try:
        await email_messages.send_password_reset(user.email, raw, ttl_minutes)
    except EmailNotConfigured:
        # Surfaced loudly in logs: with no mail configured the user has no route
        # back into their account, but the caller still must not learn anything.
        log.error("auth.password_reset_email_unconfigured", user_id=str(user.id))
    except Exception:  # noqa: BLE001 — delivery problems must not leak to the caller
        log.exception("auth.password_reset_email_failed", user_id=str(user.id))


async def confirm_password_reset(session: AsyncSession, token: str, new_password: str) -> None:
    user = await _redeem_auth_token(session, token, "password_reset")
    user.password_hash = security.hash_password(new_password)
    # A reset is the remedy for a suspected compromise, so every existing session
    # dies with it — otherwise an attacker holding a refresh token keeps access.
    await session.execute(
        update(RefreshToken).where(RefreshToken.user_id == user.id).values(revoked=True)
    )
    await _audit(session, user.household_id, user.id, "password.reset_completed", "user")
    await session.commit()

    try:
        await email_messages.send_password_changed(user.email)
    except Exception:  # noqa: BLE001 — the reset itself already succeeded
        log.warning("auth.password_changed_email_failed", user_id=str(user.id))


# --- Email verification ------------------------------------------------------

async def request_email_verification(session: AsyncSession, user: User) -> None:
    if user.email_verified_at is not None:
        return
    ttl_hours = settings.email_verification_ttl_hours
    raw = await _issue_auth_token(
        session, user, "email_verification", timedelta(hours=ttl_hours)
    )
    await session.commit()
    try:
        await email_messages.send_email_verification(user.email, raw, ttl_hours)
    except EmailNotConfigured:
        log.warning("auth.verification_email_unconfigured", user_id=str(user.id))
    except Exception:  # noqa: BLE001
        log.exception("auth.verification_email_failed", user_id=str(user.id))


async def confirm_email_verification(session: AsyncSession, token: str) -> None:
    user = await _redeem_auth_token(session, token, "email_verification")
    user.email_verified_at = _now()
    await _audit(session, user.household_id, user.id, "email.verified", "user")
    await session.commit()


# --- Household (private workspace) -------------------------------------------

async def set_workspace_base_currency(session: AsyncSession, actor: User, currency: str) -> Household:
    household = await session.get(Household, actor.household_id)
    if household is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Workspace not found")
    household.base_currency = normalize_currency(currency)
    await _audit(session, household.id, actor.id, "workspace.base_currency", "workspace")
    await session.commit()
    await session.refresh(household)
    return household
