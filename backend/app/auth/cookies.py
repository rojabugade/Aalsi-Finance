"""httpOnly refresh-token cookie + double-submit CSRF handling.

The refresh token is delivered to browsers only as an httpOnly, SameSite=strict
cookie scoped to /auth — JavaScript can never read it, so an XSS in the SPA can't
exfiltrate it. Because /auth/refresh and /auth/logout are authenticated by that
cookie, they're protected with a double-submit CSRF token: a non-httpOnly cookie the
SPA reads and echoes back in a header, which the server compares constant-time.
"""

from __future__ import annotations

import secrets

from fastapi import HTTPException, Request, Response, status

from app.config import get_settings

settings = get_settings()


def _max_age() -> int:
    return settings.refresh_token_ttl_days * 86400


def set_auth_cookies(response: Response, refresh_token: str) -> None:
    secure = settings.auth_cookie_secure
    response.set_cookie(
        settings.refresh_cookie_name,
        refresh_token,
        httponly=True,
        secure=secure,
        samesite=settings.auth_cookie_samesite,
        path="/auth",
        max_age=_max_age(),
    )
    response.set_cookie(
        settings.csrf_cookie_name,
        secrets.token_urlsafe(32),
        httponly=False,  # the SPA must read this to echo it back in the CSRF header
        secure=secure,
        samesite=settings.auth_cookie_samesite,
        path="/",
        max_age=_max_age(),
    )


def clear_auth_cookies(response: Response) -> None:
    response.delete_cookie(settings.refresh_cookie_name, path="/auth")
    response.delete_cookie(settings.csrf_cookie_name, path="/")


def read_refresh_token(request: Request, body_fallback: str | None) -> str:
    token = request.cookies.get(settings.refresh_cookie_name) or body_fallback
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing refresh token")
    return token


def verify_csrf(request: Request) -> None:
    """Enforce the double-submit CSRF check for cookie-authenticated requests. When the
    request carries no refresh cookie (a non-browser client using the body fallback),
    there's no CSRF surface, so the check is skipped."""
    if settings.refresh_cookie_name not in request.cookies:
        return
    cookie = request.cookies.get(settings.csrf_cookie_name)
    header = request.headers.get(settings.csrf_header_name)
    if not cookie or not header or not secrets.compare_digest(cookie, header):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "CSRF token missing or invalid")
