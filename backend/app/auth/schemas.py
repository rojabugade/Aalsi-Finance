"""Request/response models for the auth and household routers."""

from __future__ import annotations

import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field

Role = Literal["owner", "member", "viewer"]


# --- Auth --------------------------------------------------------------------

class SignupIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=256)
    display_name: str | None = Field(default=None, max_length=255)
    household_name: str | None = Field(default=None, max_length=255)
    base_currency: str = Field(default="USD", min_length=3, max_length=3)


class LoginIn(BaseModel):
    email: EmailStr
    password: str
    # Required only once MFA is enabled for the account.
    totp_code: str | None = Field(default=None, max_length=10)


class AccessToken(BaseModel):
    """Auth response. The access token is returned in the body (SPA keeps it in
    memory); the refresh token is delivered only as an httpOnly cookie and is never
    exposed to JavaScript."""

    access_token: str
    token_type: str = "bearer"


class RefreshIn(BaseModel):
    # Refresh token comes from the httpOnly cookie. Kept optional in the body only as
    # a fallback for non-browser clients; browsers must not send it here.
    refresh_token: str | None = None


class LogoutIn(BaseModel):
    refresh_token: str | None = None


class MfaEnrollOut(BaseModel):
    secret: str
    otpauth_uri: str


class MfaVerifyIn(BaseModel):
    totp_code: str = Field(max_length=10)


# --- Household ---------------------------------------------------------------

class HouseholdOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    base_currency: str


class HouseholdBaseCurrencyPatch(BaseModel):
    base_currency: str = Field(min_length=3, max_length=3)


class InviteIn(BaseModel):
    email: EmailStr
    role: Role = "member"


class InviteOut(BaseModel):
    invite_token: str
    email: EmailStr
    role: Role


class JoinIn(BaseModel):
    invite_token: str
    password: str = Field(min_length=8, max_length=256)
    display_name: str | None = Field(default=None, max_length=255)


class MemberOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    email: EmailStr
    display_name: str | None
    role: Role
    mfa_enabled: bool
    is_active: bool


class RoleUpdateIn(BaseModel):
    role: Role
