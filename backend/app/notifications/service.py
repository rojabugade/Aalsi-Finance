from __future__ import annotations

import json
import uuid
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import structlog
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.email.sender import EmailNotConfigured, send_email
from app.models.core import User
from app.models.debt import Loan, PaymentSchedule
from app.models.documents import Document
from app.models.fx import CrossBorderTransfer
from app.models.guidance import Notification
from app.models.transactions import Budget, Transaction
from app.notifications.schemas import CHANNELS, NotificationPreferences, NotificationPreferencesPatch

log = structlog.get_logger()
CHANNEL_ORDER = ["inapp", "email", "push", "bot"]


class NotFound(Exception):
    pass


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _jsonable(value: Any) -> Any:
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, dict):
        return {str(k): _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_jsonable(v) for v in value]
    return value


def default_preferences() -> dict:
    return NotificationPreferences().model_dump()


def get_preferences(user: User) -> dict:
    prefs = default_preferences()
    stored = user.notification_preferences or {}
    if isinstance(stored.get("channels"), dict):
        prefs["channels"].update(
            {k: bool(v) for k, v in stored["channels"].items() if k in CHANNELS}
        )
    if isinstance(stored.get("quiet_hours"), dict):
        prefs["quiet_hours"].update(stored["quiet_hours"])
    if isinstance(stored.get("types"), dict):
        prefs["types"] = stored["types"]
    return NotificationPreferences.model_validate(prefs).model_dump()


async def patch_preferences(
    session: AsyncSession, user: User, patch: NotificationPreferencesPatch
) -> dict:
    prefs = get_preferences(user)
    data = patch.model_dump(exclude_unset=True)
    if "channels" in data and data["channels"] is not None:
        prefs["channels"].update(data["channels"])
    if "quiet_hours" in data and data["quiet_hours"] is not None:
        prefs["quiet_hours"].update(data["quiet_hours"])
    if "types" in data and data["types"] is not None:
        prefs["types"] = data["types"]
    validated = NotificationPreferences.model_validate(prefs).model_dump()
    user.notification_preferences = validated
    session.add(user)
    await session.commit()
    return validated


async def list_notifications(session: AsyncSession, user: User) -> list[Notification]:
    stmt = (
        select(Notification)
        .where(
            Notification.household_id == user.household_id,
            Notification.channel == "inapp",
            Notification.status.in_(["pending", "sent", "read"]),
            or_(Notification.user_id == user.id, Notification.user_id.is_(None)),
        )
        .order_by(Notification.scheduled_for.desc().nullslast(), Notification.id.desc())
    )
    return list((await session.execute(stmt)).scalars().all())


async def mark_read(session: AsyncSession, user: User, notification_id: uuid.UUID) -> Notification:
    stmt = select(Notification).where(
        Notification.id == notification_id,
        Notification.household_id == user.household_id,
        Notification.channel == "inapp",
        or_(Notification.user_id == user.id, Notification.user_id.is_(None)),
    )
    note = (await session.execute(stmt)).scalar_one_or_none()
    if note is None:
        raise NotFound("Notification not found")
    note.status = "read"
    await session.commit()
    await session.refresh(note)
    return note


async def enqueue_notification(
    session: AsyncSession,
    *,
    household_id: uuid.UUID,
    user_id: uuid.UUID | None,
    type: str,
    payload: dict | None = None,
    scheduled_for: datetime | None = None,
    channels: list[str] | None = None,
    idempotency_key: str | None = None,
) -> list[Notification]:
    payload = _jsonable(payload or {})
    scheduled_for = scheduled_for or _utcnow()
    users = await _target_users(session, household_id, user_id)
    target_user = users[0] if users else None
    selected_channels = _enabled_channels(target_user, type, channels)
    created: list[Notification] = []
    key_base = idempotency_key or _payload_key(type, payload)
    for channel in selected_channels:
        note_user_id = target_user.id if target_user is not None else user_id
        key = f"{key_base}:{channel}"
        stmt = select(Notification).where(
            Notification.household_id == household_id,
            Notification.user_id.is_(None) if note_user_id is None else Notification.user_id == note_user_id,
            Notification.type == type,
            Notification.channel == channel,
            Notification.payload["idempotency_key"].astext == key,
        )
        existing = (await session.execute(stmt)).scalar_one_or_none()
        if existing is not None:
            continue
        note_payload = dict(payload)
        note_payload["idempotency_key"] = key
        note = Notification(
            household_id=household_id,
            user_id=note_user_id,
            type=type,
            channel=channel,
            payload=note_payload,
            scheduled_for=scheduled_for,
            status="pending",
        )
        session.add(note)
        created.append(note)
    await session.flush()
    return created


async def dispatch_due_notifications(session: AsyncSession, *, limit: int = 100) -> dict[str, int]:
    now = _utcnow()
    stmt = (
        select(Notification)
        .where(
            Notification.status == "pending",
            or_(Notification.scheduled_for.is_(None), Notification.scheduled_for <= now),
        )
        .order_by(Notification.scheduled_for.asc().nullsfirst())
        .limit(limit)
    )
    notes = list((await session.execute(stmt)).scalars().all())
    sent = failed = deferred = 0
    for note in notes:
        user = await session.get(User, note.user_id) if note.user_id else None
        if user is not None and not _channel_enabled(user, note.type, note.channel):
            _fail(note, "disabled_by_preferences")
            failed += 1
            continue
        next_time = _next_after_quiet_hours(user, now) if user is not None else None
        if next_time is not None:
            note.scheduled_for = next_time
            deferred += 1
            continue
        if await _dispatch_channel(note, user):
            note.status = "sent"
            _merge_payload(note, {"dispatched_at": now.isoformat()})
            sent += 1
        else:
            failed += 1
    await session.commit()
    return {"processed": len(notes), "sent": sent, "failed": failed, "deferred": deferred}


async def scan_and_enqueue_reminders(session: AsyncSession, *, now: datetime | None = None) -> dict[str, int]:
    now = now or _utcnow()
    today = now.date()
    totals = {"loan_due": 0, "loan_penalty_risk": 0, "budget_overspend": 0, "document_review": 0, "cross_border_reminder": 0}
    totals["loan_due"] += await _scan_loan_due(session, today)
    totals["loan_penalty_risk"] += await _scan_loan_penalties(session, today)
    totals["budget_overspend"] += await _scan_budget_overspend(session, today)
    totals["document_review"] += await _scan_pending_documents(session, now)
    totals["cross_border_reminder"] += await _scan_cross_border(session, today)
    await session.commit()
    return totals


async def _target_users(session: AsyncSession, household_id: uuid.UUID, user_id: uuid.UUID | None) -> list[User]:
    if user_id is not None:
        user = await session.get(User, user_id)
        return [user] if user is not None else []
    stmt = select(User).where(User.household_id == household_id, User.is_active.is_(True)).order_by(User.created_at.asc()).limit(1)
    return list((await session.execute(stmt)).scalars().all())


def _enabled_channels(user: User | None, notification_type: str, channels: list[str] | None) -> list[str]:
    requested = [c for c in (channels or CHANNEL_ORDER) if c in CHANNELS]
    if user is None:
        return requested or ["inapp"]
    prefs = get_preferences(user)
    type_prefs = prefs.get("types", {}).get(notification_type, {})
    if type_prefs.get("enabled") is False:
        return []
    if not channels and type_prefs.get("channels"):
        requested = [c for c in type_prefs["channels"] if c in CHANNELS]
    return [channel for channel in requested if prefs["channels"].get(channel, False)]


def _channel_enabled(user: User, notification_type: str, channel: str) -> bool:
    return channel in _enabled_channels(user, notification_type, [channel])


def _payload_key(notification_type: str, payload: dict) -> str:
    body = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return f"{notification_type}:{body}"


def _fail(note: Notification, reason: str) -> None:
    note.status = "failed"
    _merge_payload(note, {"failure_reason": reason})


def _merge_payload(note: Notification, values: dict) -> None:
    payload = dict(note.payload or {})
    payload.update(values)
    note.payload = payload


async def _dispatch_channel(note: Notification, user: User | None) -> bool:
    if note.channel == "inapp":
        return True
    if note.channel == "email":
        return await _dispatch_email(note, user)
    _fail(note, f"{note.channel}_adapter_not_configured")
    log.info("notification.dispatch_adapter_boundary", notification_id=str(note.id), channel=note.channel)
    return False


async def _dispatch_email(note: Notification, user: User | None) -> bool:
    if user is None:
        _fail(note, "no_recipient")
        return False
    # Never mail an address nobody has confirmed: a typo'd signup would otherwise
    # send a stranger someone else's financial reminders.
    if user.email_verified_at is None:
        _fail(note, "email_not_verified")
        return False
    subject, body = _email_body(note)
    try:
        await send_email(user.email, subject, body)
    except EmailNotConfigured:
        _fail(note, "email_adapter_not_configured")
        return False
    except Exception:  # noqa: BLE001 — one bad send must not stop the sweep
        log.exception("notification.email_failed", notification_id=str(note.id))
        _fail(note, "email_delivery_failed")
        return False
    return True


def _email_body(note: Notification) -> tuple[str, str]:
    payload = note.payload or {}
    title = str(payload.get("title") or _humanize(note.type))
    lines = [str(payload.get("message") or payload.get("detail") or title)]
    if payload.get("amount") is not None:
        lines.append(f"Amount: {payload['amount']}")
    if payload.get("due_date"):
        lines.append(f"Due: {payload['due_date']}")
    origin = get_settings().app_origin.rstrip("/")
    lines.append(f"\nOpen the app: {origin}/notifications")
    return title, "\n".join(lines)


def _humanize(value: str) -> str:
    return value.replace("_", " ").capitalize()


def _next_after_quiet_hours(user: User, now: datetime) -> datetime | None:
    prefs = get_preferences(user)
    quiet = prefs.get("quiet_hours", {})
    if not quiet.get("enabled"):
        return None
    try:
        tz = ZoneInfo(quiet.get("timezone") or "UTC")
    except ZoneInfoNotFoundError:
        tz = timezone.utc
    local_now = now.astimezone(tz)
    start = _parse_time(quiet.get("start", "22:00"))
    end = _parse_time(quiet.get("end", "07:00"))
    if start <= end:
        in_quiet = start <= local_now.time() < end
        end_date = local_now.date()
    else:
        in_quiet = local_now.time() >= start or local_now.time() < end
        end_date = local_now.date() + (timedelta(days=1) if local_now.time() >= start else timedelta())
    if not in_quiet:
        return None
    return datetime.combine(end_date, end, tzinfo=tz).astimezone(timezone.utc)


def _parse_time(value: str) -> time:
    hour, minute = value.split(":", 1)
    return time(int(hour), int(minute))


async def _household_user_id(session: AsyncSession, household_id: uuid.UUID) -> uuid.UUID | None:
    return await session.scalar(select(User.id).where(User.household_id == household_id, User.is_active.is_(True)).order_by(User.created_at.asc()).limit(1))


async def _scan_loan_due(session: AsyncSession, today: date) -> int:
    horizon = today + timedelta(days=7)
    rows = (
        await session.execute(
            select(Loan, PaymentSchedule)
            .join(PaymentSchedule, PaymentSchedule.loan_id == Loan.id)
            .where(PaymentSchedule.status == "due", PaymentSchedule.due_date.between(today, horizon))
        )
    ).all()
    count = 0
    for loan, payment in rows:
        created = await enqueue_notification(
            session,
            household_id=loan.household_id,
            user_id=loan.owner_user_id or await _household_user_id(session, loan.household_id),
            type="loan_due",
            payload={"loan_id": loan.id, "due_date": payment.due_date, "installment_no": payment.installment_no},
            scheduled_for=_utcnow(),
            idempotency_key=f"loan_due:{loan.id}:{payment.due_date.isoformat()}",
        )
        count += len(created)
    return count


async def _scan_loan_penalties(session: AsyncSession, today: date) -> int:
    rows = (
        await session.execute(
            select(Loan, PaymentSchedule)
            .join(PaymentSchedule, PaymentSchedule.loan_id == Loan.id)
            .where(PaymentSchedule.status == "due")
        )
    ).all()
    count = 0
    for loan, payment in rows:
        rules = loan.penalty_rules or {}
        if not rules:
            continue
        warning_days = int(rules.get("warning_days", 7))
        if not 0 <= (payment.due_date - today).days <= warning_days:
            continue
        created = await enqueue_notification(
            session,
            household_id=loan.household_id,
            user_id=loan.owner_user_id or await _household_user_id(session, loan.household_id),
            type="loan_penalty_risk",
            payload={"loan_id": loan.id, "due_date": payment.due_date, "penalty_rules": rules},
            scheduled_for=_utcnow(),
            idempotency_key=f"loan_penalty_risk:{loan.id}:{payment.due_date.isoformat()}",
        )
        count += len(created)
    return count


async def _scan_budget_overspend(session: AsyncSession, today: date) -> int:
    budgets = list((await session.execute(select(Budget))).scalars().all())
    count = 0
    for budget in budgets:
        start = _period_start(today, budget.period)
        filters = [
            Transaction.household_id == budget.household_id,
            Transaction.status == "confirmed",
            Transaction.txn_date >= start,
            Transaction.txn_date <= today,
        ]
        if budget.category_id is not None:
            filters.append(Transaction.category_id == budget.category_id)
        spent = await session.scalar(
            select(func.coalesce(func.sum(func.coalesce(Transaction.base_amount, Transaction.amount)), 0)).where(*filters)
        )
        if Decimal(str(spent or 0)) <= Decimal(str(budget.amount)):
            continue
        created = await enqueue_notification(
            session,
            household_id=budget.household_id,
            user_id=await _household_user_id(session, budget.household_id),
            type="budget_overspend",
            payload={"budget_id": budget.id, "spent": Decimal(str(spent)), "amount": Decimal(str(budget.amount)), "period_start": start},
            scheduled_for=_utcnow(),
            idempotency_key=f"budget_overspend:{budget.id}:{start.isoformat()}",
        )
        count += len(created)
    return count


async def _scan_pending_documents(session: AsyncSession, now: datetime) -> int:
    stale_before = now - timedelta(hours=24)
    docs = list((await session.execute(select(Document).where(Document.status == "needs_review", Document.created_at <= stale_before))).scalars().all())
    count = 0
    for doc in docs:
        created = await enqueue_notification(
            session,
            household_id=doc.household_id,
            user_id=doc.uploaded_by_user_id or await _household_user_id(session, doc.household_id),
            type="document_review",
            payload={"document_id": doc.id, "status": doc.status},
            scheduled_for=_utcnow(),
            idempotency_key=f"document_review:{doc.id}",
        )
        count += len(created)
    return count


async def _scan_cross_border(session: AsyncSession, today: date) -> int:
    recent_start = today - timedelta(days=30)
    rows = list((await session.execute(select(CrossBorderTransfer).where(CrossBorderTransfer.transfer_date.between(recent_start, today)))).scalars().all())
    count = 0
    for transfer in rows:
        created = await enqueue_notification(
            session,
            household_id=transfer.household_id,
            user_id=transfer.owner_user_id or await _household_user_id(session, transfer.household_id),
            type="cross_border_reminder",
            payload={"transfer_id": transfer.id, "transfer_date": transfer.transfer_date, "purpose": transfer.purpose},
            scheduled_for=_utcnow(),
            idempotency_key=f"cross_border_reminder:{transfer.id}",
        )
        count += len(created)
    return count


def _period_start(today: date, period: str) -> date:
    if period == "yearly":
        return date(today.year, 1, 1)
    if period == "quarterly":
        month = ((today.month - 1) // 3) * 3 + 1
        return date(today.year, month, 1)
    if period == "weekly":
        return today - timedelta(days=today.weekday())
    return date(today.year, today.month, 1)
