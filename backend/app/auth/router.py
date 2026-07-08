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
    LoginIn,
    LogoutIn,
    MfaEnrollOut,
    MfaVerifyIn,
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


@router.post("/mfa/verify", status_code=status.HTTP_204_NO_CONTENT)
async def mfa_verify(
    data: MfaVerifyIn,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    await service.mfa_verify(session, user, data.totp_code)
