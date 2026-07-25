"""Request/response models for the auth and private-workspace routers."""

from __future__ import annotations

import uuid

from pydantic import BaseModel, ConfigDict, EmailStr, Field


# --- Auth --------------------------------------------------------------------

class SignupIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=256)
    display_name: str | None = Field(default=None, max_length=255)
    workspace_name: str | None = Field(default=None, max_length=255)
    base_currency: str = Field(default="USD", min_length=3, max_length=3)


class LoginIn(BaseModel):
    email: EmailStr
    password: str
    # Required only once MFA is enabled. Accepts either a 6-digit TOTP code or a
    # recovery code, which is longer (XXXX-XXXX-XXXX-XXXX, or 16 chars unpunctuated).
    totp_code: str | None = Field(default=None, max_length=32)


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


class MfaRecoveryCodesOut(BaseModel):
    """Recovery codes are returned once, at generation time, and never again."""

    recovery_codes: list[str]


class MfaStatusOut(BaseModel):
    mfa_enabled: bool
    unused_recovery_codes: int


# --- Account recovery --------------------------------------------------------

class PasswordResetRequestIn(BaseModel):
    email: EmailStr


class PasswordResetConfirmIn(BaseModel):
    token: str = Field(min_length=1, max_length=512)
    new_password: str = Field(min_length=8, max_length=256)


class EmailVerificationConfirmIn(BaseModel):
    token: str = Field(min_length=1, max_length=512)


class MeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    email: EmailStr
    display_name: str | None
    email_verified: bool
    mfa_enabled: bool


# --- Private workspace -------------------------------------------------------

class WorkspaceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    base_currency: str


class WorkspaceBaseCurrencyPatch(BaseModel):
    base_currency: str = Field(min_length=3, max_length=3)
