"""Alert lifecycle: upsert AlertSpecs into analyst_alert by signature, preserve
acknowledged state across re-emits, and auto-resolve alerts (scoped to the
producers in the current run) whose signature stopped firing."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.analyst.insight.specs import AlertSpec
from app.auth.deps import scoped_query
from app.models.alerts import AnalystAlertRow
from app.models.core import User


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def sync_alerts(
    session: AsyncSession, household_id: uuid.UUID, specs: list[AlertSpec], *, producers: set[str],
) -> dict:
    existing = list((await session.execute(
        select(AnalystAlertRow).where(
            AnalystAlertRow.household_id == household_id,
            AnalystAlertRow.state != "resolved",
        )
    )).scalars().all())
    by_sig = {row.signature: row for row in existing}
    seen: set[str] = set()
    created: list[AnalystAlertRow] = []
    updated = 0
    for spec in specs:
        seen.add(spec.signature)
        row = by_sig.get(spec.signature)
        if row is None:
            row = AnalystAlertRow(
                household_id=household_id, kind=spec.kind, producer=spec.producer,
                severity=spec.severity, tone=spec.tone, signature=spec.signature,
                state="active", title=spec.title, detail=spec.detail,
                suggested_action=spec.suggested_action, supporting_refs=spec.supporting_refs,
            )
            session.add(row)
            created.append(row)
        else:
            row.kind = spec.kind
            row.severity = spec.severity
            row.tone = spec.tone
            row.title = spec.title
            row.detail = spec.detail
            row.suggested_action = spec.suggested_action
            row.supporting_refs = spec.supporting_refs
            updated += 1  # state intentionally preserved
    resolved = 0
    now = _now()
    for sig, row in by_sig.items():
        if sig not in seen and row.producer in producers and row.state in ("active", "acknowledged"):
            row.state = "resolved"
            row.resolved_at = now
            resolved += 1
    await session.commit()
    return {"created": created, "resolved": resolved, "updated": updated}


async def list_alerts(session: AsyncSession, user: User) -> list[AnalystAlertRow]:
    stmt = (
        scoped_query(AnalystAlertRow, user)
        .where(AnalystAlertRow.state != "resolved")
        # active (0) before acknowledged (1), then most severe first.
        .order_by(
            (AnalystAlertRow.state == "acknowledged"),
            AnalystAlertRow.severity.desc(),
            AnalystAlertRow.created_at.desc(),
        )
    )
    return list((await session.execute(stmt)).scalars().all())


async def acknowledge_alert(session: AsyncSession, user: User, alert_id: uuid.UUID) -> AnalystAlertRow | None:
    row = (await session.execute(
        scoped_query(AnalystAlertRow, user).where(AnalystAlertRow.id == alert_id)
    )).scalar_one_or_none()
    if row is None:
        return None
    row.state = "acknowledged"
    row.acknowledged_at = _now()
    await session.commit()
    return row
