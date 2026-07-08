"""Per-household alert scan: build the snapshot, run the deterministic and
(optional) LLM insight producers, sync them into analyst_alert, and optionally
enqueue notifications for freshly-created alerts. scan_all_households is the
entry point for the scheduled Celery job."""

from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.analyst.insight.engine import sync_alerts
from app.analyst.insight.correlation import correlation_specs
from app.analyst.insight.llm import llm_insight_specs
from app.analyst.insight.specs import derive_alert_specs
from app.analyst.memory.assembler import assemble
from app.analyst.snapshot import build_snapshot
from app.models.core import Household, User
from app.notifications import service as notifications


async def run_alert_scan(
    session: AsyncSession, user: User, llm=None, *,
    from_date: date | None = None, to_date: date | None = None,
    llm_insights: bool = True, notify: bool = False,
) -> dict:
    to_date = to_date or date.today()
    from_date = from_date or (to_date - timedelta(days=90))
    snapshot = await build_snapshot(session, user, from_date, to_date)
    specs = list(derive_alert_specs(snapshot))
    producers = {"deterministic"}
    if llm is not None and llm_insights:
        try:
            ctx = await assemble(session, user, "Surface notable financial issues", llm, from_date, to_date)
        except Exception:
            ctx = None
        specs += await llm_insight_specs(session, user, snapshot, llm, ctx)
        producers.add("insight")
        try:
            specs += await correlation_specs(session, user, llm)
        except Exception:  # correlation is best-effort; never break the scan
            pass
        producers.add("correlation")
    result = await sync_alerts(session, user.household_id, specs, producers=producers)
    if notify and result["created"]:
        for row in result["created"]:
            await notifications.enqueue_notification(
                session, household_id=user.household_id, user_id=user.id,
                type="analyst_alert",
                payload={"alert_id": str(row.id), "kind": row.kind, "title": row.title, "detail": row.detail},
                idempotency_key=f"analyst_alert:{row.signature}",
            )
        await session.commit()
    active = sum(1 for s in specs)  # specs reflect the conditions currently firing
    return {"created": len(result["created"]), "resolved": result["resolved"], "active": active}


async def scan_all_households(session: AsyncSession, get_llm) -> dict:
    households = list((await session.execute(select(Household))).scalars().all())
    totals = {"households": 0, "created": 0, "resolved": 0}
    for hh in households:
        user = (await session.execute(
            select(User).where(User.household_id == hh.id, User.is_active.is_(True))
            .order_by(User.created_at.asc()).limit(1)
        )).scalar_one_or_none()
        if user is None:
            continue
        try:
            llm = await get_llm(hh.id)
        except Exception:
            llm = None
        try:
            out = await run_alert_scan(session, user, llm, llm_insights=llm is not None, notify=True)
        except Exception:
            continue  # one bad household must not abort the rest
        totals["households"] += 1
        totals["created"] += out["created"]
        totals["resolved"] += out["resolved"]
    return totals
