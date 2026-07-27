"""Request/response models for the public beta endpoints."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, EmailStr, Field, field_validator


class BetaApplicationIn(BaseModel):
    email: EmailStr
    name: str | None = Field(default=None, max_length=255)
    # ISO 3166-1 alpha-2. Optional: it steers who gets invited first (Plaid only
    # covers US institutions today) but nobody is turned away for omitting it.
    country: str | None = Field(default=None, min_length=2, max_length=2)
    how_you_track_money: str | None = Field(default=None, max_length=1000)

    @field_validator("country")
    @classmethod
    def upper_country(cls, value: str | None) -> str | None:
        return value.upper() if value else None


class BetaApplicationOut(BaseModel):
    """Deliberately contentless.

    The endpoint is unauthenticated, so a response that varied between "you're
    new" and "you already applied" would be an email-enumeration oracle. Every
    caller gets this same object.
    """

    status: str = "received"


class BetaStatusOut(BaseModel):
    invite_required: bool


class AllowanceOut(BaseModel):
    used: int
    limit: int
    remaining: int
    # Null when nothing has been used yet, or when the limit is off.
    next_credit_at: datetime | None = None


class BetaUsageOut(BaseModel):
    """What a beta account has left. Rendered in Settings so the first sign of a
    ceiling isn't a 429 in the middle of a question.

    `active` is false once every limit is set to 0, which is what lifting the
    beta looks like — the client hides the whole panel rather than showing
    limits of zero.
    """

    active: bool
    ai_requests: AllowanceOut
    documents: AllowanceOut
    # The dollar ceiling behind the request counts, surfaced as context rather
    # than a live meter: it is enforced on estimated cost, and showing someone a
    # running estimate of their own spend on our key invites the wrong argument.
    ai_daily_cost_limit_usd: float
    ai_requests_per_minute: int
