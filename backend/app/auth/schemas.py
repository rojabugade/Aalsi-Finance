"""Request/response models for the auth and household routers."""

from __future__ import annotations

import uuid

from pydantic import BaseModel, ConfigDict, EmailStr, Field


# --- Auth --------------------------------------------------------------------

class SignupIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=256)
    display_name: str | None = Field(default=None, max_length=255)
    # Optional label for the account's private workspace. Sharing was removed, so
    # this no longer opts into a multi-user household — it is purely cosmetic.
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


# --- Household (private workspace; sharing/membership removed) ----------------

class HouseholdOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    base_currency: str
    sharing_enabled: bool


class HouseholdBaseCurrencyPatch(BaseModel):
    base_currency: str = Field(min_length=3, max_length=3)
