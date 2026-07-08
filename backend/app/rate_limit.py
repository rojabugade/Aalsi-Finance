"""Application rate limiter (slowapi), Redis-backed so limits hold across API
replicas and restarts.

Only abuse-prone endpoints opt in via ``@limiter.limit(...)``: login and refresh
(brute-force / token-guessing) and the public SMS webhook. The limiter keys on the
real client IP, honoring the first X-Forwarded-For hop when behind a proxy.
"""

from __future__ import annotations

from slowapi import Limiter
from slowapi.util import get_remote_address
from starlette.requests import Request

from app.config import get_settings

settings = get_settings()


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return get_remote_address(request)


limiter = Limiter(
    key_func=client_ip,
    storage_uri=(settings.rate_limit_storage_uri or settings.redis_url),
    enabled=settings.rate_limit_enabled,
    # Fail open: if the Redis backend is unreachable, allow the request rather than
    # 500-ing every login. A rate-limiter outage must not become an auth outage.
    swallow_errors=True,
)
