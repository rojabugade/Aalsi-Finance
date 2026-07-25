"""Scheduled Plaid sync.

Linked accounts previously only refreshed when someone pressed Sync in the UI, so
"transactions sync automatically" was not true. This sweeps every active item on a
schedule.

One workspace's failure — a revoked item, an institution outage — must not abort
the sweep, so each is isolated.
"""

from __future__ import annotations

import structlog
from sqlalchemy import select

from app.celery_app import celery
from app.db import SessionLocal, run_task
from app.ingestion import service
from app.ingestion.gateways import PlaidGateway
from app.ingestion.schemas import PlaidSyncIn
from app.models.accounts import PlaidItem
from app.models.core import User
from app.config import get_settings

log = structlog.get_logger()


@celery.task(name="plaid.sync_all")
def sync_all_plaid_items() -> dict:
    return run_task(_sync_all_plaid_items())


async def _sync_all_plaid_items() -> dict:
    settings = get_settings()
    if not (settings.plaid_client_id and settings.plaid_secret):
        log.info("plaid.sync_all_skipped_unconfigured")
        return {"workspaces": 0, "synced": 0, "failed": 0, "skipped": "unconfigured"}

    gateway = PlaidGateway(settings)
    synced = failed = 0

    async with SessionLocal() as session:
        household_ids = list(
            (
                await session.execute(
                    select(PlaidItem.household_id)
                    .where(PlaidItem.status == "active")
                    .distinct()
                )
            ).scalars().all()
        )

    for household_id in household_ids:
        try:
            async with SessionLocal() as session:
                # plaid_sync is user-scoped for authorisation; a workspace holds one
                # active account, so the earliest active user is that account.
                user = (
                    await session.execute(
                        select(User)
                        .where(User.household_id == household_id, User.is_active.is_(True))
                        .order_by(User.created_at.asc())
                        .limit(1)
                    )
                ).scalar_one_or_none()
                if user is None:
                    continue
                result = await service.plaid_sync(
                    session, user, PlaidSyncIn(plaid_item_id=None), gateway
                )
                synced += 1
                log.info(
                    "plaid.sync_all_workspace_done",
                    household_id=str(household_id),
                    transactions_created=result.get("transactions_created"),
                )
        except Exception:  # noqa: BLE001 — one workspace must not abort the sweep
            failed += 1
            log.exception("plaid.sync_all_workspace_failed", household_id=str(household_id))

    return {"workspaces": len(household_ids), "synced": synced, "failed": failed}
