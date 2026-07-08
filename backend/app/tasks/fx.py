"""Daily FX refresh Celery task (M14)."""

from __future__ import annotations

from app.celery_app import celery
from app.db import SessionLocal, run_task
from app.fx import service


@celery.task(name="fx.refresh_daily")
def refresh_daily_fx() -> dict:
    return run_task(_refresh_daily_fx())


async def _refresh_daily_fx() -> dict:
    async with SessionLocal() as session:
        return await service.refresh_used_rates(session)
