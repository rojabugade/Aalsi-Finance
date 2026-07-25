"""Error tracking.

Inert unless SENTRY_DSN is set, so local dev and the test suite report nothing.

This is a personal-finance app, so the default Sentry behaviour is too permissive:
`send_default_pii` stays off, and a scrubber strips request bodies, cookies and
headers before an event leaves the process. An exception report must never carry
someone's transactions, documents or credentials.
"""

from __future__ import annotations

from typing import Any

import structlog

from app.config import get_settings

log = structlog.get_logger()

# Header and cookie names are dropped wholesale rather than pattern-matched: the
# auth cookie, the CSRF cookie and the bearer token all live here.
_DROP_REQUEST_KEYS = ("data", "cookies", "headers", "env")


def _scrub(event: dict[str, Any], _hint: dict[str, Any]) -> dict[str, Any]:
    request = event.get("request")
    if isinstance(request, dict):
        for key in _DROP_REQUEST_KEYS:
            request.pop(key, None)
        # A query string can carry a reset or download token.
        request.pop("query_string", None)
    event.pop("user", None)
    return event


def configure_error_tracking() -> None:
    settings = get_settings()
    dsn = settings.sentry_dsn.strip()
    if not dsn:
        log.info("observability.sentry_disabled")
        return

    import sentry_sdk

    sentry_sdk.init(
        dsn=dsn,
        environment=settings.environment,
        release=settings.sentry_release or None,
        traces_sample_rate=settings.sentry_traces_sample_rate,
        # Never attach user identifiers, IPs or request bodies automatically.
        send_default_pii=False,
        max_request_body_size="never",
        before_send=_scrub,
    )
    log.info("observability.sentry_enabled", environment=settings.environment)
