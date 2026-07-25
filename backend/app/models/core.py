"""Household, users, auth tokens, consent, audit, and LLM usage logging."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import (
    Base,
    TimestampMixin,
    currency_col,
    fk_uuid,
    str_enum,
    uuid_pk,
)


class Household(Base, TimestampMixin):
    __tablename__ = "household"

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    base_currency: Mapped[str] = currency_col(nullable=False, default="USD")
    # Temporary, removable UI-managed LLM override. The API key is encrypted
    # before it is placed in this JSON document.
    llm_config: Mapped[dict | None] = mapped_column(JSONB)

    users: Mapped[list["User"]] = relationship(back_populates="household")


class User(Base, TimestampMixin):
    __tablename__ = "user"

    id: Mapped[uuid.UUID] = uuid_pk()
    household_id: Mapped[uuid.UUID] = fk_uuid(
        ForeignKey("household.id", ondelete="CASCADE"), index=True, nullable=False
    )
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(255))
    locale: Mapped[str | None] = mapped_column(String(16), default="en-US")
    mfa_secret: Mapped[str | None] = mapped_column(String(64))
    mfa_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # Null until the address is confirmed. Login is not gated on this — a deployment
    # with no SMTP configured would otherwise lock every account out — but unverified
    # addresses are surfaced to the user and to the notification dispatcher.
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    notification_preferences: Mapped[dict | None] = mapped_column(JSONB)

    household: Mapped[Household] = relationship(back_populates="users")


class RefreshToken(Base):
    __tablename__ = "refresh_token"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = fk_uuid(
        ForeignKey("user.id", ondelete="CASCADE"), index=True, nullable=False
    )
    token_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class AuthToken(Base):
    """Single-use, emailed token for password reset and email verification.

    Only the SHA-256 hash is stored, exactly as for refresh tokens — a database
    leak must not hand an attacker working reset links. `purpose` keeps both flows
    in one table so they share expiry, single-use and revocation logic.
    """

    __tablename__ = "auth_token"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = fk_uuid(
        ForeignKey("user.id", ondelete="CASCADE"), index=True, nullable=False
    )
    purpose: Mapped[str] = mapped_column(
        str_enum("auth_token_purpose", "password_reset", "email_verification"),
        nullable=False,
    )
    token_hash: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class MfaRecoveryCode(Base):
    """One-time code that substitutes for a TOTP code at login.

    Issued as a batch when MFA is switched on; without them a lost authenticator
    app means a permanently inaccessible account. Codes carry ~80 bits of entropy,
    so a fast hash is sufficient here for the same reason it is for refresh tokens.
    """

    __tablename__ = "mfa_recovery_code"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = fk_uuid(
        ForeignKey("user.id", ondelete="CASCADE"), index=True, nullable=False
    )
    code_hash: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class ConsentRecord(Base):
    __tablename__ = "consent_record"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = fk_uuid(
        ForeignKey("user.id", ondelete="CASCADE"), index=True, nullable=False
    )
    channel: Mapped[str] = mapped_column(
        str_enum("consent_channel", "sms", "email", "bot", "plaid", "splitwise"), nullable=False
    )
    granted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    granted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[uuid.UUID] = uuid_pk()
    household_id: Mapped[uuid.UUID] = fk_uuid(
        ForeignKey("household.id", ondelete="CASCADE"), index=True, nullable=False
    )
    actor_user_id: Mapped[uuid.UUID | None] = fk_uuid(ForeignKey("user.id", ondelete="SET NULL"))
    action: Mapped[str] = mapped_column(String(128), nullable=False)
    entity: Mapped[str | None] = mapped_column(String(128))
    before: Mapped[dict | None] = mapped_column(JSONB)
    after: Mapped[dict | None] = mapped_column(JSONB)
    ts: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class LLMUsageLog(Base, TimestampMixin):
    __tablename__ = "llm_usage_log"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID | None] = fk_uuid(ForeignKey("user.id", ondelete="SET NULL"))
    provider: Mapped[str] = mapped_column(String(64), nullable=False)
    model: Mapped[str] = mapped_column(String(128), nullable=False)
    tokens_in: Mapped[int | None] = mapped_column(Integer)
    tokens_out: Mapped[int | None] = mapped_column(Integer)
    cost_est: Mapped[float | None] = mapped_column(Numeric(18, 6))
    purpose: Mapped[str | None] = mapped_column(String(128))
