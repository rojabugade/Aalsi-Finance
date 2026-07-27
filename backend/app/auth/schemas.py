"""Request/response models for the auth and private-workspace routers."""

from __future__ import annotations

import uuid

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


# The strictest of the regimes this product serves. India's DPDP Act treats
# everyone under 18 as a child requiring verifiable parental consent; the US
# floor (COPPA) is 13. Serving both means the higher bar governs, so there is
# one number here rather than a per-region table.
MINIMUM_AGE = 18


# --- Auth --------------------------------------------------------------------

class SignupIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=256)
    display_name: str | None = Field(default=None, max_length=255)
    workspace_name: str | None = Field(default=None, max_length=255)
    base_currency: str = Field(default="USD", min_length=3, max_length=3)
    # Both are required and must be true. No defaults: a client that omits them
    # gets a 422 rather than silently creating an unattested account, which is
    # the whole point of enforcing this server-side instead of in the form.
    age_confirmed: bool
    terms_accepted: bool
    # Required only while `beta_invite_required` is set. Optional here rather
    # than mandatory so the gate can be lifted by config alone; the service
    # decides whether a missing code is fatal.
    invite_code: str | None = Field(default=None, max_length=64)

    @field_validator("age_confirmed")
    @classmethod
    def require_age_confirmation(cls, value: bool) -> bool:
        if not value:
            raise ValueError(f"you must confirm you are at least {MINIMUM_AGE} years old")
        return value

    @field_validator("terms_accepted")
    @classmethod
    def require_terms_acceptance(cls, value: bool) -> bool:
        if not value:
            raise ValueError("you must accept the Terms of Service and Privacy Policy")
        return value


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
