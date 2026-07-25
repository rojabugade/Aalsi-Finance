"""/auth endpoints: signup, login, refresh, logout, MFA enroll/verify."""

# NOTE: no `from __future__ import annotations` here. The slowapi @limiter.limit
# wrapper carries its own module globals, so FastAPI can't resolve stringized
# annotations on rate-limited endpoints and would demote the request body to a
# query param (422). Keeping annotations eager avoids that.

from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import service
from app.auth.cookies import clear_auth_cookies, read_refresh_token, set_auth_cookies, verify_csrf
from app.auth.deps import get_current_user
from app.auth.schemas import (
    AccessToken,
    EmailVerificationConfirmIn,
    LoginIn,
    LogoutIn,
    MeOut,
    MfaEnrollOut,
    MfaRecoveryCodesOut,
    MfaStatusOut,
    MfaVerifyIn,
    PasswordResetConfirmIn,
    PasswordResetRequestIn,
    RefreshIn,
    SignupIn,
)
from app.config import get_settings
from app.db import get_session
from app.models.core import User
from app.rate_limit import limiter

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()


@router.post("/signup", response_model=AccessToken, status_code=status.HTTP_201_CREATED)
@limiter.limit(settings.rate_limit_login)
async def signup(request: Request, data: SignupIn, response: Response, session: AsyncSession = Depends(get_session)) -> AccessToken:
    access, refresh = await service.signup(session, data)
    set_auth_cookies(response, refresh)
    return AccessToken(access_token=access)


@router.post("/login", response_model=AccessToken)
@limiter.limit(settings.rate_limit_login)
async def login(request: Request, data: LoginIn, response: Response, session: AsyncSession = Depends(get_session)) -> AccessToken:
    access, refresh = await service.login(session, data.email, data.password, data.totp_code)
    set_auth_cookies(response, refresh)
    return AccessToken(access_token=access)


@router.post("/refresh", response_model=AccessToken)
@limiter.limit(settings.rate_limit_refresh)
async def refresh(request: Request, response: Response, data: RefreshIn | None = None, session: AsyncSession = Depends(get_session)) -> AccessToken:
    verify_csrf(request)
    raw = read_refresh_token(request, data.refresh_token if data else None)
    access, refresh_tok = await service.refresh(session, raw)
    set_auth_cookies(response, refresh_tok)
    return AccessToken(access_token=access)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(request: Request, response: Response, data: LogoutIn | None = None, session: AsyncSession = Depends(get_session)):
    verify_csrf(request)
    raw = request.cookies.get(settings.refresh_cookie_name) or (data.refresh_token if data else None)
    if raw:
        await service.logout(session, raw)
    clear_auth_cookies(response)


@router.post("/mfa/enroll", response_model=MfaEnrollOut)
async def mfa_enroll(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> MfaEnrollOut:
    secret, uri = await service.mfa_enroll(session, user)
    return MfaEnrollOut(secret=secret, otpauth_uri=uri)


@router.post("/mfa/verify", response_model=MfaRecoveryCodesOut)
async def mfa_verify(
    data: MfaVerifyIn,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> MfaRecoveryCodesOut:
    """Activate MFA. The recovery codes in this response are shown only once."""
    codes = await service.mfa_verify(session, user, data.totp_code)
    return MfaRecoveryCodesOut(recovery_codes=codes)


@router.get("/mfa/status", response_model=MfaStatusOut)
async def mfa_status(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> MfaStatusOut:
    remaining = await service.count_unused_recovery_codes(session, user)
    return MfaStatusOut(mfa_enabled=user.mfa_enabled, unused_recovery_codes=remaining)


@router.post("/mfa/recovery-codes", response_model=MfaRecoveryCodesOut)
async def regenerate_recovery_codes(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> MfaRecoveryCodesOut:
    """Issue a fresh batch, invalidating every previously issued code."""
    codes = await service.regenerate_recovery_codes(session, user)
    return MfaRecoveryCodesOut(recovery_codes=codes)


# --- Account recovery --------------------------------------------------------

@router.post("/password-reset/request", status_code=status.HTTP_202_ACCEPTED)
@limiter.limit(settings.rate_limit_password_reset)
async def password_reset_request(
    request: Request,
    data: PasswordResetRequestIn,
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    """Always 202, whether or not the address is registered.

    A different status or body for unknown addresses would let anyone test which
    emails have accounts here.
    """
    await service.request_password_reset(session, data.email)
    return {"status": "accepted"}


@router.post("/password-reset/confirm", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit(settings.rate_limit_password_reset)
async def password_reset_confirm(
    request: Request,
    data: PasswordResetConfirmIn,
    response: Response,
    session: AsyncSession = Depends(get_session),
):
    await service.confirm_password_reset(session, data.token, data.new_password)
    # Every session was revoked server-side; drop this client's cookies to match.
    clear_auth_cookies(response)


@router.post("/verify-email/request", status_code=status.HTTP_202_ACCEPTED)
@limiter.limit(settings.rate_limit_password_reset)
async def verify_email_request(
    request: Request,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> dict[str, str]:
    await service.request_email_verification(session, user)
    return {"status": "accepted"}


@router.post("/verify-email/confirm", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit(settings.rate_limit_password_reset)
async def verify_email_confirm(
    request: Request,
    data: EmailVerificationConfirmIn,
    session: AsyncSession = Depends(get_session),
):
    await service.confirm_email_verification(session, data.token)


@router.get("/me", response_model=MeOut)
async def me(user: User = Depends(get_current_user)) -> MeOut:
    return MeOut(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        email_verified=user.email_verified_at is not None,
        mfa_enabled=user.mfa_enabled,
    )
