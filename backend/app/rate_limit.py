"""Application rate limiter (slowapi), Redis-backed so limits hold across API
replicas and restarts.

Only abuse-prone endpoints opt in via ``@limiter.limit(...)``: login and refresh
(brute-force / token-guessing) and the public SMS webhook. The limiter keys on the
real client IP. X-Forwarded-For is client-supplied and trivially spoofable, so it is
only honoured for the number of proxy hops configured in ``trusted_proxy_count``;
otherwise the socket peer is used. This stops an attacker from rotating XFF per
request to mint unlimited buckets and defeat the brute-force protection.
"""

from __future__ import annotations

from slowapi import Limiter
from slowapi.util import get_remote_address
from starlette.requests import Request

from app.config import get_settings

settings = get_settings()


def client_ip(request: Request) -> str:
    trusted = settings.trusted_proxy_count
    if trusted > 0:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            hops = [hop.strip() for hop in forwarded.split(",") if hop.strip()]
            # With N trusted proxies the real client is the Nth hop from the right;
            # anything to its left is forged by the client. Fall through to the
            # socket peer if the header is shorter than the trusted chain.
            if len(hops) >= trusted:
                return hops[-trusted]
    return get_remote_address(request)


limiter = Limiter(
    key_func=client_ip,
    storage_uri=(settings.rate_limit_storage_uri or settings.redis_url),
    enabled=settings.rate_limit_enabled,
    # Fail open: if the Redis backend is unreachable, allow the request rather than
    # 500-ing every login. A rate-limiter outage must not become an auth outage.
    swallow_errors=True,
)
