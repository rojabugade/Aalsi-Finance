"""Beta gate business logic: applications in, codes out, codes spent once."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import structlog
from fastapi import HTTPException, status
from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.beta.codes import generate_code, hash_code, normalize
from app.beta.schemas import BetaApplicationIn
from app.config import get_settings
from app.models.beta import BetaApplication, InviteCode

settings = get_settings()
log = structlog.get_logger()


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def record_application(session: AsyncSession, data: BetaApplicationIn) -> None:
    """Store (or refresh) an application. Never raises on a duplicate.

    Re-applying is a normal thing for someone who forgot they already did, and
    the router returns the same body either way, so the only sane behaviour is
    to update the existing row. Status is left alone — a second application must
    not walk an already-declined address back to pending.
    """
    email = data.email.lower()
    existing = (
        await session.execute(select(BetaApplication).where(BetaApplication.email == email))
    ).scalar_one_or_none()

    if existing is None:
        session.add(
            BetaApplication(
                email=email,
                name=data.name,
                country=data.country,
                how_you_track_money=data.how_you_track_money,
            )
        )
    else:
        existing.name = data.name or existing.name
        existing.country = data.country or existing.country
        existing.how_you_track_money = (
            data.how_you_track_money or existing.how_you_track_money
        )

    await session.commit()


async def mint_codes(
    session: AsyncSession,
    *,
    count: int = 1,
    email: str | None = None,
    expires_days: int | None = None,
    note: str | None = None,
) -> list[str]:
    """Create `count` unredeemed codes and return their plaintext, once.

    If `email` matches a pending application it is marked invited, so the
    application list doubles as the queue of people still waiting.
    """
    expires_at = _now() + timedelta(days=expires_days) if expires_days else None
    application_id: uuid.UUID | None = None

    if email:
        email = email.lower()
        application = (
            await session.execute(
                select(BetaApplication).where(BetaApplication.email == email)
            )
        ).scalar_one_or_none()
        if application is not None:
            application_id = application.id
            application.status = "invited"
            application.invited_at = _now()

    plaintext: list[str] = []
    for _ in range(count):
        code = generate_code()
        plaintext.append(code)
        session.add(
            InviteCode(
                code_hash=hash_code(code),
                issued_to_email=email,
                application_id=application_id,
                note=note,
                expires_at=expires_at,
            )
        )

    await session.commit()
    return plaintext


async def redeem_code(session: AsyncSession, code: str, user_id: uuid.UUID) -> None:
    """Spend a code for `user_id`, or raise 400.

    The whole check is one conditional UPDATE rather than a SELECT followed by a
    write, which is what makes single-use hold when two people submit the same
    code at once. Under Postgres' READ COMMITTED the second statement blocks on
    the row lock, then re-evaluates its WHERE against the committed version,
    finds `redeemed_at` no longer NULL, and matches nothing. A read-then-write
    would have both transactions pass the read and both mint an account.

    Caller must not commit before this returns: redemption and account creation
    belong to the same transaction, or a failure between them either burns a
    code with no account or creates an account with no code spent.
    """
    if not normalize(code):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid or already used invite code")

    now = _now()
    result = await session.execute(
        update(InviteCode)
        .where(
            InviteCode.code_hash == hash_code(code),
            InviteCode.redeemed_at.is_(None),
            or_(InviteCode.expires_at.is_(None), InviteCode.expires_at > now),
        )
        .values(redeemed_at=now, redeemed_by_user_id=user_id)
        .returning(InviteCode.id)
    )

    if result.scalar_one_or_none() is None:
        # One message for unknown, spent and expired alike — distinguishing them
        # tells someone probing codes which guesses were real.
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid or already used invite code")
