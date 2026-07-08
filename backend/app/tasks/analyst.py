"""Scheduled analyst alert scan (W2). Runs the full deterministic + LLM insight
producers across every household and writes persistent alerts + notifications."""

from __future__ import annotations

import uuid

from sqlalchemy import select

from app.analyst.insight.scan import scan_all_households
from app.analyst.memory.ingest import index_source
from app.analyst.memory.reconcile import reconcile_household
from app.celery_app import celery
from app.db import SessionLocal, run_task
from app.llm.client import get_household_llm_client
from app.models.core import Household


@celery.task(name="analyst.scan_alerts")
def scan_alerts() -> dict:
    return run_task(_scan_alerts())


async def _scan_alerts() -> dict:
    async with SessionLocal() as session:
        async def get_llm(household_id):
            return await get_household_llm_client(session, household_id)
        return await scan_all_households(session, get_llm)


@celery.task(name="analyst.index_source")
def index_source_task(household_id: str, source_type: str, source_ids: list[str]) -> dict:
    return run_task(_index_source(household_id, source_type, source_ids))


async def _index_source(household_id: str, source_type: str, source_ids: list[str]) -> dict:
    hh = uuid.UUID(household_id)
    ids = [uuid.UUID(s) for s in source_ids]
    async with SessionLocal() as session:
        llm = await get_household_llm_client(session, hh)
        return {"indexed": await index_source(session, hh, source_type, ids, llm)}


@celery.task(name="analyst.reindex_daily")
def reindex_daily() -> dict:
    return run_task(_reindex_daily())


async def _reindex_daily() -> dict:
    total = 0
    async with SessionLocal() as session:
        household_ids = list((await session.execute(select(Household.id))).scalars().all())
        for hh in household_ids:
            try:
                llm = await get_household_llm_client(session, hh)
                counts = await reconcile_household(session, hh, llm)
                total += sum(counts.values())
            except Exception:  # one household's failure must not abort the sweep
                continue
    return {"households": len(household_ids), "indexed": total}
