from __future__ import annotations

import csv
import io
import json
import uuid
import zipfile
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Iterable

from fastapi import HTTPException, status
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import scoped_query
from app.config import get_settings as get_app_settings
from app.ingestion.crypto import encrypt_string
from app.models.accounts import AccountLogical, PlaidItem
from app.models.core import (
    AuditLog,
    ConsentRecord,
    Household,
    LLMUsageLog,
    RefreshToken,
    User,
)
from app.models.debt import Loan, PaymentSchedule
from app.models.documents import Document
from app.models.fx import CrossBorderTransfer
from app.models.guidance import Notification, Recommendation
from app.models.income import EquityEvent, EquityGrant, IncomeSource, Paystub
from app.models.ingestion import IngestionConnection
from app.models.social import BotLink
from app.models.transactions import (
    Budget,
    Category,
    LineItem,
    LineItemTag,
    Merchant,
    Rule,
    Tag,
    Transaction,
    TransactionTag,
)

CONFIRM_DELETE = "DELETE MY ACCOUNT"
NOTIFICATION_PREFS_LINK = "/notifications/preferences"
CONSENT_CHANNELS = {"sms", "email", "bot", "plaid"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _jsonable(value):
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return value


def _row(obj, fields: Iterable[str]) -> dict[str, str]:
    out: dict[str, str] = {}
    for field in fields:
        value = getattr(obj, field)
        if isinstance(value, (dict, list)):
            out[field] = json.dumps(value, sort_keys=True, default=_jsonable)
        else:
            converted = _jsonable(value)
            out[field] = "" if converted is None else str(converted)
    return out


def _csv_bytes(rows: list[dict[str, str]], fields: list[str]) -> bytes:
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=fields)
    writer.writeheader()
    writer.writerows(rows)
    return stream.getvalue().encode("utf-8")


async def export_csv_zip(session: AsyncSession, user: User) -> bytes:
    txns = list((await session.execute(scoped_query(Transaction, user).order_by(Transaction.txn_date, Transaction.id))).scalars().all())
    txn_ids = [txn.id for txn in txns]
    line_items = []
    if txn_ids:
        line_items = list((await session.execute(select(LineItem).where(LineItem.transaction_id.in_(txn_ids)).order_by(LineItem.id))).scalars().all())

    loans = list((await session.execute(scoped_query(Loan, user).order_by(Loan.name, Loan.id))).scalars().all())
    loan_ids = [loan.id for loan in loans]
    schedules = []
    if loan_ids:
        schedules = list((await session.execute(select(PaymentSchedule).where(PaymentSchedule.loan_id.in_(loan_ids)).order_by(PaymentSchedule.loan_id, PaymentSchedule.installment_no))).scalars().all())

    income_sources = list((await session.execute(scoped_query(IncomeSource, user).order_by(IncomeSource.id))).scalars().all())
    income_source_ids = [source.id for source in income_sources]
    paystubs: list[Paystub] = []
    equity_grants: list[EquityGrant] = []
    equity_events: list[EquityEvent] = []
    if income_source_ids:
        paystubs = list((await session.execute(select(Paystub).where(Paystub.income_source_id.in_(income_source_ids)).order_by(Paystub.id))).scalars().all())
        equity_grants = list((await session.execute(select(EquityGrant).where(EquityGrant.income_source_id.in_(income_source_ids)).order_by(EquityGrant.id))).scalars().all())
        grant_ids = [grant.id for grant in equity_grants]
        if grant_ids:
            equity_events = list((await session.execute(select(EquityEvent).where(EquityEvent.equity_grant_id.in_(grant_ids)).order_by(EquityEvent.id))).scalars().all())

    txn_fields = ["id", "household_id", "account_id", "owner_user_id", "merchant_id", "amount", "currency", "base_amount", "fx_rate", "txn_date", "category_id", "status", "source_document_id", "source_channel", "is_shared", "flags", "notes", "confidence", "external_id"]
    line_item_fields = ["id", "transaction_id", "name", "item_type_category_id", "amount", "quantity", "confidence"]
    loan_fields = ["id", "household_id", "owner_user_id", "name", "type", "schedule_kind", "principal", "currency", "interest_rate", "compounding", "min_or_emi_amount", "due_day", "penalty_rules", "start_date", "end_date"]
    schedule_fields = ["id", "loan_id", "installment_no", "due_date", "principal_component", "interest_component", "balance_after", "status"]
    income_fields = ["id", "household_id", "owner_user_id", "employer", "country", "currency", "frequency", "gross", "net", "withholding"]
    paystub_fields = ["id", "income_source_id", "source_document_id", "period_start", "period_end", "gross", "deductions", "net"]
    grant_fields = ["id", "income_source_id", "type", "ticker", "country", "grant_date", "shares", "strike_price", "vesting_schedule"]
    event_fields = ["id", "equity_grant_id", "type", "event_date", "shares", "fmv", "proceeds", "est_tax"]

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("transactions.csv", _csv_bytes([_row(t, txn_fields) for t in txns], txn_fields))
        zf.writestr("line_items.csv", _csv_bytes([_row(i, line_item_fields) for i in line_items], line_item_fields))
        zf.writestr("loans.csv", _csv_bytes([_row(l, loan_fields) for l in loans], loan_fields))
        zf.writestr("loan_payment_schedules.csv", _csv_bytes([_row(s, schedule_fields) for s in schedules], schedule_fields))
        zf.writestr("income_sources.csv", _csv_bytes([_row(s, income_fields) for s in income_sources], income_fields))
        zf.writestr("paystubs.csv", _csv_bytes([_row(p, paystub_fields) for p in paystubs], paystub_fields))
        zf.writestr("equity_grants.csv", _csv_bytes([_row(g, grant_fields) for g in equity_grants], grant_fields))
        zf.writestr("equity_events.csv", _csv_bytes([_row(e, event_fields) for e in equity_events], event_fields))
    return buf.getvalue()


async def export_pdf(session: AsyncSession, user: User) -> bytes:
    household = await session.get(Household, user.household_id)
    txn_subq = scoped_query(Transaction, user).subquery()
    loan_subq = scoped_query(Loan, user).subquery()
    income_subq = scoped_query(IncomeSource, user).subquery()
    txn_count = await session.scalar(select(func.count()).select_from(txn_subq)) or 0
    loan_count = await session.scalar(select(func.count()).select_from(loan_subq)) or 0
    income_count = await session.scalar(select(func.count()).select_from(income_subq)) or 0
    total_spend = await session.scalar(select(func.coalesce(func.sum(txn_subq.c.amount), 0))) or Decimal("0")
    loan_principal = await session.scalar(select(func.coalesce(func.sum(loan_subq.c.principal), 0))) or Decimal("0")
    income_net = await session.scalar(select(func.coalesce(func.sum(income_subq.c.net), 0))) or Decimal("0")

    lines = [
        "Personal Finance Export Summary",
        f"Generated at: {_now().isoformat(timespec='seconds')}",
        f"Household: {household.name if household else user.household_id}",
        f"Base currency: {household.base_currency if household else 'USD'}",
        f"Transactions visible to requester: {txn_count}",
        f"Transaction amount total: {total_spend}",
        f"Loans visible to requester: {loan_count}",
        f"Loan principal total: {loan_principal}",
        f"Income sources visible to requester: {income_count}",
        f"Income source net total: {income_net}",
        "This report summarizes exported transaction, line item, loan, and income data.",
    ]
    return _simple_pdf(lines)


def _pdf_text(value: str) -> str:
    return value.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _simple_pdf(lines: list[str]) -> bytes:
    rendered = ["BT", "/F1 11 Tf", "50 780 Td", "14 TL"]
    for idx, line in enumerate(lines[:48]):
        if idx:
            rendered.append("T*")
        rendered.append(f"({_pdf_text(line)}) Tj")
    rendered.append("ET")
    content = "\n".join(rendered).encode("latin-1", "replace")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length " + str(len(content)).encode("ascii") + b" >>\nstream\n" + content + b"\nendstream",
    ]
    buf = io.BytesIO()
    buf.write(b"%PDF-1.4\n")
    offsets = [0]
    for idx, obj in enumerate(objects, start=1):
        offsets.append(buf.tell())
        buf.write(f"{idx} 0 obj\n".encode("ascii"))
        buf.write(obj)
        buf.write(b"\nendobj\n")
    xref = buf.tell()
    buf.write(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    buf.write(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        buf.write(f"{offset:010d} 00000 n \n".encode("ascii"))
    buf.write(f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode("ascii"))
    return buf.getvalue()


async def get_settings(session: AsyncSession, user: User) -> dict:
    household = await session.get(Household, user.household_id)
    locale = user.locale or "en-US"
    app_settings = get_app_settings()
    llm_config = household.llm_config if household and household.llm_config else None
    return {
        "base_currency": (household.base_currency if household else "USD"),
        "locale": locale,
        "language": _language_from_locale(locale),
        "notification_preferences_link": NOTIFICATION_PREFS_LINK,
        "llm_provider": (llm_config or {}).get("provider", app_settings.llm_provider),
        "llm_base_url": (llm_config or {}).get("base_url", app_settings.llm_base_url),
        "llm_model": (llm_config or {}).get("model", app_settings.chat_model) or None,
        "llm_api_key_configured": bool(
            (llm_config or {}).get("api_key_encrypted")
            if llm_config is not None
            else app_settings.llm_api_key
        ),
        "llm_settings_source": "app" if llm_config is not None else "environment",
    }


async def patch_settings(session: AsyncSession, user: User, data) -> dict:
    household = await session.get(Household, user.household_id)
    values = data.model_dump(exclude_unset=True)
    before = await get_settings(session, user)
    if "base_currency" in values and values["base_currency"] is not None:
        if household is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Household not found")
        household.base_currency = values["base_currency"].upper()[:3]
    if values.get("locale") is not None:
        user.locale = values["locale"]
    elif values.get("language") is not None:
        user.locale = _locale_from_language(values["language"])
    llm_fields = {"llm_provider", "llm_base_url", "llm_model", "llm_api_key"}
    if llm_fields.intersection(values):
        if household is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Household not found")
        current = dict(household.llm_config or {})
        if values.get("llm_provider") is not None:
            current["provider"] = values["llm_provider"]
        if "llm_base_url" in values:
            current["base_url"] = values["llm_base_url"] or None
        if "llm_model" in values:
            current["model"] = values["llm_model"] or ""
        if "llm_api_key" in values:
            key = values["llm_api_key"] or ""
            current["api_key_encrypted"] = encrypt_string(key) if key else None
        # First save creates a complete override rather than silently mixing in
        # provider credentials from the environment.
        app_settings = get_app_settings()
        current.setdefault("provider", app_settings.llm_provider)
        current.setdefault("base_url", app_settings.llm_base_url)
        current.setdefault("model", app_settings.chat_model)
        current.setdefault("api_key_encrypted", None)
        household.llm_config = current
    audit_values = dict(values)
    if "llm_api_key" in audit_values:
        audit_values["llm_api_key"] = "[redacted]"
    session.add(AuditLog(household_id=user.household_id, actor_user_id=user.id, action="settings.update", entity="settings", before=before, after=audit_values))
    await session.commit()
    return await get_settings(session, user)


def _language_from_locale(locale: str) -> str:
    value = (locale or "en").lower()
    if value.startswith("hinglish"):
        return "hinglish"
    if value.startswith("hi"):
        return "hi"
    return "en"


def _locale_from_language(language: str) -> str:
    value = language.lower()
    if value in {"hi", "hindi"}:
        return "hi-IN"
    if value == "hinglish":
        return "hinglish-IN"
    return "en-US"


async def list_consents(session: AsyncSession, user: User) -> list[ConsentRecord]:
    rows = list((await session.execute(select(ConsentRecord).where(ConsentRecord.user_id == user.id))).scalars().all())
    latest: dict[str, ConsentRecord] = {}
    for row in rows:
        row_ts = row.revoked_at or row.granted_at or datetime.min.replace(tzinfo=timezone.utc)
        current = latest.get(row.channel)
        current_ts = current.revoked_at or current.granted_at or datetime.min.replace(tzinfo=timezone.utc) if current else None
        if current is None or row_ts >= current_ts:
            latest[row.channel] = row
    return [
        latest.get(channel)
        or ConsentRecord(user_id=user.id, channel=channel, granted=False, granted_at=None, revoked_at=None)
        for channel in sorted(CONSENT_CHANNELS)
    ]


async def revoke_consent(session: AsyncSession, user: User, channel: str) -> ConsentRecord:
    if channel not in CONSENT_CHANNELS:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Consent channel not found")
    await _invalidate_channel(session, user, channel)
    row = ConsentRecord(user_id=user.id, channel=channel, granted=False, granted_at=None, revoked_at=_now())
    session.add(row)
    session.add(AuditLog(household_id=user.household_id, actor_user_id=user.id, action="consent.revoke", entity=channel, before=None, after={"channel": channel, "granted": False}))
    await session.commit()
    await session.refresh(row)
    return row


async def _invalidate_channel(session: AsyncSession, user: User, channel: str) -> None:
    if channel in {"email", "sms"}:
        await session.execute(update(IngestionConnection).where(IngestionConnection.user_id == user.id, IngestionConnection.channel == channel).values(status="revoked", token_encrypted=None))
    elif channel == "plaid":
        await session.execute(update(PlaidItem).where(PlaidItem.household_id == user.household_id).values(status="revoked", access_token_encrypted=None))
    elif channel == "bot":
        await session.execute(update(BotLink).where(BotLink.user_id == user.id).values(token=None, consent={"granted": False, "revoked_at": _now().isoformat()}))


async def delete_account(session: AsyncSession, user: User, confirmation: str) -> None:
    if confirmation != CONFIRM_DELETE:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"confirmation must equal {CONFIRM_DELETE!r}")

    household_users = list((await session.execute(select(User).where(User.household_id == user.household_id))).scalars().all())
    owner_count = len([row for row in household_users if row.role == "owner" and row.is_active])
    full_household_delete = user.role == "owner" and owner_count <= 1
    before = {"user_id": str(user.id), "household_id": str(user.household_id), "full_household_delete": full_household_delete}
    session.add(AuditLog(household_id=user.household_id, actor_user_id=user.id, action="account.delete", entity="user", before=before, after={"status": "deactivated"}))
    await session.flush()

    targets = household_users if full_household_delete else [user]
    for target in targets:
        await session.execute(update(RefreshToken).where(RefreshToken.user_id == target.id).values(revoked=True))
        await session.execute(update(IngestionConnection).where(IngestionConnection.user_id == target.id).values(status="revoked", token_encrypted=None))
        await session.execute(update(BotLink).where(BotLink.user_id == target.id).values(token=None, consent={"granted": False, "revoked_at": _now().isoformat()}))
        session.add(ConsentRecord(user_id=target.id, channel="email", granted=False, revoked_at=_now()))
        session.add(ConsentRecord(user_id=target.id, channel="sms", granted=False, revoked_at=_now()))
        session.add(ConsentRecord(user_id=target.id, channel="bot", granted=False, revoked_at=_now()))
        session.add(ConsentRecord(user_id=target.id, channel="plaid", granted=False, revoked_at=_now()))
        await session.execute(update(LLMUsageLog).where(LLMUsageLog.user_id == target.id).values(user_id=None))
        if not full_household_delete:
            await _anonymize_owned_rows(session, target.id)
        target.email = f"deleted+{target.id}@deleted.local"
        target.display_name = None
        target.password_hash = "deleted"
        target.mfa_secret = None
        target.mfa_enabled = False
        target.is_active = False

    if full_household_delete:
        await _delete_household_financial_data(session, user.household_id)
        household = await session.get(Household, user.household_id)
        if household is not None:
            household.name = f"Deleted household {household.id}"
    await session.commit()


async def _anonymize_owned_rows(session: AsyncSession, user_id: uuid.UUID) -> None:
    await session.execute(update(AccountLogical).where(AccountLogical.owner_user_id == user_id).values(owner_user_id=None))
    await session.execute(update(Transaction).where(Transaction.owner_user_id == user_id).values(owner_user_id=None))
    await session.execute(update(Loan).where(Loan.owner_user_id == user_id).values(owner_user_id=None))
    await session.execute(update(IncomeSource).where(IncomeSource.owner_user_id == user_id).values(owner_user_id=None))
    await session.execute(update(CrossBorderTransfer).where(CrossBorderTransfer.owner_user_id == user_id).values(owner_user_id=None))
    await session.execute(update(Document).where(Document.uploaded_by_user_id == user_id).values(uploaded_by_user_id=None))
    await session.execute(update(Notification).where(Notification.user_id == user_id).values(user_id=None))
    await session.execute(update(Recommendation).where(Recommendation.user_id == user_id).values(user_id=None))


async def _delete_household_financial_data(session: AsyncSession, household_id: uuid.UUID) -> None:
    loan_ids = select(Loan.id).where(Loan.household_id == household_id)
    source_ids = select(IncomeSource.id).where(IncomeSource.household_id == household_id)
    grant_ids = select(EquityGrant.id).where(EquityGrant.income_source_id.in_(source_ids))
    txn_ids = select(Transaction.id).where(Transaction.household_id == household_id)
    line_item_ids = select(LineItem.id).where(LineItem.transaction_id.in_(txn_ids))
    tag_ids = select(Tag.id).where(Tag.household_id == household_id)
    await session.execute(delete(LineItemTag).where(LineItemTag.line_item_id.in_(line_item_ids)))
    await session.execute(delete(TransactionTag).where(TransactionTag.transaction_id.in_(txn_ids)))
    await session.execute(delete(TransactionTag).where(TransactionTag.tag_id.in_(tag_ids)))
    await session.execute(delete(LineItem).where(LineItem.transaction_id.in_(txn_ids)))
    await session.execute(delete(Transaction).where(Transaction.household_id == household_id))
    await session.execute(delete(PaymentSchedule).where(PaymentSchedule.loan_id.in_(loan_ids)))
    await session.execute(delete(Loan).where(Loan.household_id == household_id))
    await session.execute(delete(EquityEvent).where(EquityEvent.equity_grant_id.in_(grant_ids)))
    await session.execute(delete(EquityGrant).where(EquityGrant.income_source_id.in_(source_ids)))
    await session.execute(delete(Paystub).where(Paystub.income_source_id.in_(source_ids)))
    await session.execute(delete(IncomeSource).where(IncomeSource.household_id == household_id))
    await session.execute(delete(CrossBorderTransfer).where(CrossBorderTransfer.household_id == household_id))
    await session.execute(delete(Budget).where(Budget.household_id == household_id))
    await session.execute(delete(Rule).where(Rule.household_id == household_id))
    await session.execute(delete(Tag).where(Tag.household_id == household_id))
    await session.execute(delete(Merchant).where(Merchant.household_id == household_id))
    await session.execute(delete(Category).where(Category.household_id == household_id))
    await session.execute(delete(AccountLogical).where(AccountLogical.household_id == household_id))
    await session.execute(update(PlaidItem).where(PlaidItem.household_id == household_id).values(status="revoked", access_token_encrypted=None))
    await session.execute(delete(Document).where(Document.household_id == household_id))
    await session.execute(delete(Notification).where(Notification.household_id == household_id))
    await session.execute(delete(Recommendation).where(Recommendation.household_id == household_id))
