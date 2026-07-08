"""M13 notification scheduler and dispatcher Celery entrypoints."""

from __future__ import annotations

from app.celery_app import celery
from app.db import SessionLocal, run_task
from app.notifications import service


@celery.task(name="notifications.scan_and_enqueue")
def scan_and_enqueue() -> dict[str, int]:
    return run_task(_scan_and_enqueue())


@celery.task(name="notifications.dispatch_due")
def dispatch_due() -> dict[str, int]:
    return run_task(_dispatch_due())


async def _scan_and_enqueue() -> dict[str, int]:
    async with SessionLocal() as session:
        return await service.scan_and_enqueue_reminders(session)


async def _dispatch_due() -> dict[str, int]:
    async with SessionLocal() as session:
        return await service.dispatch_due_notifications(session)
