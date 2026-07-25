"""Liveness and readiness probes.

`/health` is liveness: it answers as long as the process can serve a request, and
must never touch a dependency — a probe that fails when Postgres blips would have
an orchestrator restart healthy API containers during a database incident.

`/health/ready` is readiness: it checks the dependencies the app cannot serve
without, and is what a load balancer or deploy gate should watch. Each check is
bounded by its own timeout so one hung dependency cannot hang the probe.
"""

from __future__ import annotations

import asyncio

import structlog
from fastapi import APIRouter, Response, status
from sqlalchemy import text

from app.config import get_settings
from app.db import SessionLocal
from app.version import COMMIT, VERSION

router = APIRouter(tags=["meta"])
log = structlog.get_logger()

CHECK_TIMEOUT_SECONDS = 3.0


@router.get("/health")
async def health() -> dict[str, str]:
    """Liveness. Deliberately dependency-free — see the module docstring."""
    return {"status": "ok"}


@router.get("/version")
async def version() -> dict[str, str]:
    return {"version": VERSION, "commit": COMMIT}


async def _check_database() -> None:
    async with SessionLocal() as session:
        await session.execute(text("SELECT 1"))


async def _check_redis() -> None:
    import redis.asyncio as aioredis

    client = aioredis.from_url(get_settings().redis_url)
    try:
        await client.ping()
    finally:
        await client.aclose()


async def _check_storage() -> None:
    from app.documents.storage import get_object_store

    # ensure_bucket is the cheapest round-trip that proves credentials work; it is
    # idempotent, so a readiness probe can call it safely.
    await asyncio.to_thread(get_object_store().ensure_bucket)


_CHECKS = {
    "database": _check_database,
    "redis": _check_redis,
    "storage": _check_storage,
}


async def _run_check(name: str, fn) -> tuple[str, str | None]:
    try:
        await asyncio.wait_for(fn(), timeout=CHECK_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        return name, f"timed out after {CHECK_TIMEOUT_SECONDS}s"
    except Exception as exc:  # noqa: BLE001 — any failure means "not ready"
        return name, str(exc)
    return name, None


@router.get("/health/ready")
async def ready(response: Response) -> dict:
    """Readiness. 503 when any dependency is unreachable.

    The response body names the failing dependency so an operator can tell a
    database outage from a storage one without reading logs.
    """
    results = await asyncio.gather(
        *(_run_check(name, fn) for name, fn in _CHECKS.items())
    )
    checks = {name: ("ok" if error is None else "error") for name, error in results}
    failures = {name: error for name, error in results if error is not None}

    if failures:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        log.warning("health.not_ready", failures=failures)
        return {"status": "not_ready", "checks": checks, "errors": failures}
    return {"status": "ready", "checks": checks}
