"""Auth & household business logic. Routers stay thin; this holds the rules.

Refresh tokens rotate on every use: the presented token is revoked and a fresh one
issued. Presenting an already-revoked token is treated as theft — every refresh token
for that user is revoked (reuse detection).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import security
from app.auth.schemas import SignupIn
from app.config import get_settings
from app.fx.service import normalize_currency
from app.models.core import AuditLog, Household, RefreshToken, User

settings = get_settings()


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _get_user_by_email(session: AsyncSession, email: str) -> User | None:
    res = await session.execute(select(User).where(User.email == email.lower()))
    return res.scalar_one_or_none()


async def _issue_tokens(session: AsyncSession, user: User) -> tuple[str, str]:
    """Mint an access token and a persisted (hashed) refresh token."""
    access = security.create_access_token(user.id, user.household_id, user.role)
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
        name=data.household_name or data.display_name or data.email,
        base_currency=data.base_currency.upper(),
        # Supplying a name is the explicit API-level opt-in for a shared household.
        sharing_enabled=bool(data.household_name),
    )
    session.add(household)
    await session.flush()  # populate household.id

    user = User(
        household_id=household.id,
        email=data.email.lower(),
        password_hash=security.hash_password(data.password),
        display_name=data.display_name,
        role="owner",
    )
    session.add(user)
    await session.flush()

    await _audit(session, household.id, user.id, "account.create", "user")
    tokens = await _issue_tokens(session, user)
    await session.commit()
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
        if not totp_code or not user.mfa_secret or not security.verify_totp(
            user.mfa_secret, totp_code
        ):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or missing MFA code")

    tokens = await _issue_tokens(session, user)
    await session.commit()
    return tokens


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


async def mfa_verify(session: AsyncSession, user: User, code: str) -> None:
    if not user.mfa_secret:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "MFA not enrolled")
    if not security.verify_totp(user.mfa_secret, code):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid MFA code")
    user.mfa_enabled = True
    await _audit(session, user.household_id, user.id, "mfa.enable", "user")
    await session.commit()


# --- Household membership ----------------------------------------------------

async def enable_household_sharing(
    session: AsyncSession, actor: User, name: str
) -> Household:
    household = await session.get(Household, actor.household_id)
    if household is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Workspace not found")

    if household.sharing_enabled:
        if household.name == name:
            return household
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Household sharing is already enabled"
        )

    household.name = name
    household.sharing_enabled = True
    await _audit(session, household.id, actor.id, "household.create", "household")
    await session.commit()
    await session.refresh(household)
    return household


async def create_invite(
    session: AsyncSession, actor: User, email: str, role: str
) -> str:
    household = await session.get(Household, actor.household_id)
    if household is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Workspace not found")
    if not household.sharing_enabled:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Create a household before inviting people",
        )
    return security.create_invite_token(household.id, email, role)


async def join(session: AsyncSession, data) -> tuple[str, str]:
    try:
        payload = security.decode_token(data.invite_token, security.INVITE_TOKEN_TYPE)
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid or expired invite")

    email = payload["email"].lower()
    if await _get_user_by_email(session, email):
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")

    household = await session.get(Household, uuid.UUID(payload["hid"]))
    if household is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Household no longer exists")

    user = User(
        household_id=household.id,
        email=email,
        password_hash=security.hash_password(data.password),
        display_name=data.display_name,
        role=payload["role"],
    )
    session.add(user)
    await session.flush()
    await _audit(session, household.id, user.id, "household.join", "user")
    tokens = await _issue_tokens(session, user)
    await session.commit()
    return tokens


async def list_members(session: AsyncSession, household_id: uuid.UUID) -> list[User]:
    res = await session.execute(
        select(User).where(User.household_id == household_id).order_by(User.created_at)
    )
    return list(res.scalars().all())


async def set_household_base_currency(session: AsyncSession, actor: User, currency: str) -> Household:
    household = await session.get(Household, actor.household_id)
    if household is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Household not found")
    household.base_currency = normalize_currency(currency)
    await _audit(session, household.id, actor.id, "household.base_currency", "household")
    await session.commit()
    await session.refresh(household)
    return household


async def _member_or_404(
    session: AsyncSession, household_id: uuid.UUID, member_id: uuid.UUID
) -> User:
    member = await session.get(User, member_id)
    if member is None or member.household_id != household_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")
    return member


async def change_role(
    session: AsyncSession, actor: User, member_id: uuid.UUID, role: str
) -> User:
    member = await _member_or_404(session, actor.household_id, member_id)
    # Don't allow demoting the last remaining owner.
    if member.role == "owner" and role != "owner":
        if await _count_owners(session, actor.household_id) <= 1:
            raise HTTPException(
                status.HTTP_409_CONFLICT, "Household must keep at least one owner"
            )
    member.role = role
    await _audit(session, actor.household_id, actor.id, "member.role_change", "user")
    await session.commit()
    return member


async def remove_member(
    session: AsyncSession, actor: User, member_id: uuid.UUID
) -> None:
    member = await _member_or_404(session, actor.household_id, member_id)
    if member.id == actor.id:
        raise HTTPException(status.HTTP_409_CONFLICT, "Cannot remove yourself")
    if member.role == "owner" and await _count_owners(session, actor.household_id) <= 1:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Household must keep at least one owner"
        )
    await _audit(session, actor.household_id, actor.id, "member.remove", "user")
    await session.delete(member)
    await session.commit()


async def _count_owners(session: AsyncSession, household_id: uuid.UUID) -> int:
    res = await session.execute(
        select(User).where(User.household_id == household_id, User.role == "owner")
    )
    return len(res.scalars().all())
