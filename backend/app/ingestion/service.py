from __future__ import annotations

import base64
import hashlib
import json
import logging
import secrets
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.documents import service as doc_service
from app.documents.processing import UnsupportedFile
from app.documents.storage import get_object_store
from app.config import get_settings
from app.ingestion import plaid_matching
from app.ingestion.crypto import decrypt_string, encrypt_string
from app.ingestion.gateways import GmailGateway, PlaidGateway
from app.ingestion.schemas import (
    EmailInboundIn,
    EmailParsed,
    PlaidExchangeIn,
    PlaidLinkTokenIn,
    PlaidSyncIn,
    SmsParsed,
    SmsWebhookIn,
)
from app.llm.client import LLMClient, get_household_llm_client
from app.loans import service as loans_service
from app.models.accounts import AccountLogical, PlaidItem
from app.models.core import ConsentRecord, User
from app.models.debt import CreditCardDetail, Loan
from app.models.documents import Document
from app.models.ingestion import IngestionConnection
from app.transactions import service as txn_service
from app.transactions.schemas import TransactionCreate


logger = logging.getLogger(__name__)


class NotFound(Exception):
    pass


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _money(v) -> Decimal:
    return Decimal(str(v or "0")).quantize(Decimal("0.01"))


def _currency(v: str | None) -> str:
    return (v or "USD").upper()[:3]


# OAuth token responses carry the primary secret (which we encrypt separately) plus
# extra fields. Some of those extras are ALSO secrets — Splitwise returns a
# refresh_token, Gmail returns a live access token. Never persist them to the
# unencrypted config JSONB; keep only non-secret metadata for display/expiry logic.
_SAFE_TOKEN_META_KEYS = frozenset({"expiry", "expires_in", "expires_at", "scope", "token_type", "created_at"})


def _safe_token_meta(token: dict) -> dict:
    return {k: v for k, v in token.items() if k in _SAFE_TOKEN_META_KEYS}


def _json_safe(value):
    """Coerce a value into something a JSONB column can store. The Plaid SDK's
    .to_dict() returns native date/datetime (and Decimal) objects, which the
    JSON serializer rejects; round-trip through json with str() as the fallback."""
    return json.loads(json.dumps(value, default=str))


async def record_consent(session: AsyncSession, user: User, channel: str, granted: bool = True) -> None:
    session.add(ConsentRecord(user_id=user.id, channel=channel, granted=granted, granted_at=datetime.now(timezone.utc) if granted else None, revoked_at=None if granted else datetime.now(timezone.utc)))
    await session.flush()


async def plaid_link_token(session: AsyncSession, user: User, data: PlaidLinkTokenIn, gateway: PlaidGateway) -> dict:
    access_token = None
    if data.plaid_item_id is not None:
        item = (await session.execute(select(PlaidItem).where(
            PlaidItem.id == data.plaid_item_id, PlaidItem.household_id == user.household_id,
        ))).scalar_one_or_none()
        if item is None:
            raise NotFound("Plaid item not found")
        access_token = decrypt_string(item.access_token_encrypted)
        if not access_token:
            raise NotFound("Plaid item has no usable access token; disconnect and link again")
    out = await gateway.create_link_token(str(user.id), access_token)
    return {**out, "update_mode": access_token is not None}


async def plaid_exchange(session: AsyncSession, user: User, data: PlaidExchangeIn, gateway: PlaidGateway) -> dict:
    exchanged = await gateway.exchange_public_token(data.public_token)
    access_token = exchanged.get("access_token")
    item = PlaidItem(household_id=user.household_id, access_token_encrypted=encrypt_string(access_token), institution_name=data.institution_name, status="active")
    session.add(item)
    await session.flush()
    # A fresh Link flow for an already-linked bank creates a brand-new Plaid item
    # with new account_ids. Reattach the incoming accounts to the existing
    # AccountLogical rows (same institution + mask + type) instead of duplicating
    # them, so their transaction history and balances stay in one place.
    existing_plaid_accounts = list((await session.execute(
        select(AccountLogical).where(
            AccountLogical.household_id == user.household_id,
            AccountLogical.plaid_item_id.is_not(None),
        )
    )).scalars().all())
    items_by_id = {
        i.id: i for i in (await session.execute(
            select(PlaidItem).where(PlaidItem.household_id == user.household_id)
        )).scalars().all()
    }

    def _same_institution(existing: AccountLogical) -> bool:
        old_item = items_by_id.get(existing.plaid_item_id)
        old_name = (old_item.institution_name or "").strip().lower() if old_item else ""
        new_name = (data.institution_name or "").strip().lower()
        return bool(old_name and new_name and old_name == new_name)

    accounts_created = 0
    accounts_relinked = 0
    old_item_ids: set[uuid.UUID] = set()
    for account in data.accounts:
        mask = account.get("mask")
        acct_type = _account_type(account.get("type"), account.get("subtype"))
        new_plaid_account_id = account.get("account_id") or account.get("id")
        match = next(
            (a for a in existing_plaid_accounts
             if mask and a.mask == mask and a.type == acct_type
             and a.plaid_item_id != item.id and _same_institution(a)),
            None,
        )
        if match is not None:
            old_item_ids.add(match.plaid_item_id)
            # Keep any Plaid-synced loans pointed at the surviving account.
            await session.execute(
                update(Loan).where(
                    Loan.household_id == user.household_id,
                    Loan.plaid_account_id == match.plaid_account_id,
                ).values(plaid_item_id=item.id, plaid_account_id=new_plaid_account_id)
            )
            match.plaid_item_id = item.id
            match.plaid_account_id = new_plaid_account_id
            existing_plaid_accounts.remove(match)  # one incoming account per row
            accounts_relinked += 1
            continue
        session.add(AccountLogical(
            household_id=user.household_id,
            owner_user_id=user.id,
            label=account.get("name") or account.get("official_name") or "Plaid account",
            type=acct_type,
            currency=_currency(account.get("currency") or account.get("iso_currency_code")),
            is_shared=False,
            mask=mask,
            plaid_item_id=item.id,
            plaid_account_id=new_plaid_account_id,
        ))
        accounts_created += 1
    # Old items that lost all their accounts are dead weight — revoke them so
    # plaid_sync stops touching them and their tokens are dropped.
    for old_id in old_item_ids:
        remaining = (await session.execute(
            select(func.count()).select_from(AccountLogical).where(AccountLogical.plaid_item_id == old_id)
        )).scalar_one()
        old_item = items_by_id.get(old_id)
        if old_item is not None and int(remaining) == 0:
            old_item.status = "revoked"
            old_item.access_token_encrypted = None
    await record_consent(session, user, "plaid")
    await session.commit()
    return {"plaid_item_id": item.id, "accounts_created": accounts_created, "accounts_relinked": accounts_relinked, "status": "active"}


# transactions/sync returns at most ~500 updates per page and signals more with
# has_more. Drain every page or a real account's first sync silently truncates.
# The cap is a safety valve against a stuck (non-advancing) cursor.
_MAX_SYNC_PAGES = 500


async def _drain_sync(gateway: PlaidGateway, token: str, cursor: str | None) -> tuple[list, list, list, str | None]:
    """Follow transactions/sync pagination until has_more is false, accumulating
    the added/modified/removed batches and returning the final cursor to persist."""
    added: list = []
    modified: list = []
    removed: list = []
    for _ in range(_MAX_SYNC_PAGES):
        payload = await gateway.sync_transactions(token, cursor)
        added.extend(payload.get("added", []))
        modified.extend(payload.get("modified", []))
        removed.extend(payload.get("removed", []))
        next_cursor = payload.get("next_cursor") or cursor
        if not payload.get("has_more"):
            return added, modified, removed, next_cursor
        if next_cursor == cursor:  # cursor didn't advance but more claimed — bail out
            return added, modified, removed, next_cursor
        cursor = next_cursor
    return added, modified, removed, cursor


async def plaid_sync(session: AsyncSession, user: User, data: PlaidSyncIn, gateway: PlaidGateway) -> dict:
    stmt = select(PlaidItem).where(PlaidItem.household_id == user.household_id, PlaidItem.status == "active")
    if data.plaid_item_id:
        stmt = stmt.where(PlaidItem.id == data.plaid_item_id)
    items = list((await session.execute(stmt)).scalars().all())
    if not items:
        raise NotFound("Plaid item not found")
    docs_created, txns_created, txns_updated, txns_removed, loans_synced, balances_written, cursor = 0, 0, 0, 0, 0, 0, None
    payments_registered, refunds_linked = 0, 0
    for item in items:
        token = decrypt_string(item.access_token_encrypted)
        if not token:
            continue
        await gateway.sandbox_fire_default_update(token)  # trigger DEFAULT_UPDATE for user_transactions_dynamic
        added, modified, removed, cursor = await _drain_sync(gateway, token, item.sync_cursor)
        doc = Document(household_id=user.household_id, uploaded_by_user_id=user.id, storage_key=f"plaid://{item.id}/{uuid.uuid4()}", type="statement", source_channel="plaid", status="processed", ocr_meta={"plaid": _json_safe({"added": added, "modified": modified, "removed": removed, "next_cursor": cursor})})
        session.add(doc)
        await session.flush()
        docs_created += 1
        accounts_by_id = await _accounts_by_plaid_id(session, user.household_id)

        def _to_create(txn: dict) -> TransactionCreate:
            pfc = txn.get("personal_finance_category") or {}
            pending = bool(txn.get("pending"))
            flags: dict = {}
            if pfc:
                flags["plaid_pfc"] = {"primary": pfc.get("primary"), "detailed": pfc.get("detailed")}
            if pending:
                flags["pending"] = True
            return TransactionCreate(
                account_id=accounts_by_id.get(txn.get("account_id")),
                merchant=txn.get("merchant_name") or txn.get("name"),
                amount=-_money(txn.get("amount")),
                currency=_currency(txn.get("iso_currency_code")),
                txn_date=_date(txn.get("date")),
                # Posted bank transactions are facts — auto-confirm so analytics see
                # them immediately; review is about category, not existence. Pending
                # ones stay draft until Plaid posts them (a `modified` event).
                status="draft" if pending else "confirmed",
                source_document_id=doc.id,
                source_channel="plaid",
                notes=txn.get("name"),
                confidence=1.0,
                external_id=txn.get("transaction_id"),
                flags=flags or None,
            )

        synced_ids: list[uuid.UUID] = []
        for txn in added:
            created = await txn_service.create_transaction(session, user, _to_create(txn))
            synced_ids.append(created.id)
            txns_created += 1
        # `modified` = pending→posted amount/status changes; update the existing row
        # in place instead of letting dedup return it unchanged.
        for txn in modified:
            updated = await txn_service.create_transaction(session, user, _to_create(txn), update_on_conflict=True)
            synced_ids.append(updated.id)
            txns_updated += 1
        # `removed` = reversed/cancelled txns; drop them so they don't linger.
        removed_ids = [r.get("transaction_id") for r in removed if r.get("transaction_id")]
        txns_removed += await txn_service.delete_external_transactions(session, user, "plaid", removed_ids)

        liabilities = await gateway.get_liabilities(token)
        loans_synced += await _sync_liabilities(session, user, item, liabilities)
        balances_written += await _sync_balances(session, user, await gateway.get_accounts(token))
        try:
            enriched = await plaid_matching.enrich_after_sync(session, user, synced_ids)
            payments_registered += enriched["payments_registered"]
            refunds_linked += enriched["refunds_linked"]
        except Exception:  # noqa: BLE001 — enrichment must never fail the sync
            logger.exception("plaid enrichment failed for item %s", item.id)
        item.sync_cursor = cursor
        await session.commit()
    return {"documents_created": docs_created, "transactions_created": txns_created, "transactions_updated": txns_updated, "transactions_removed": txns_removed, "loans_synced": loans_synced, "balances_written": balances_written, "payments_registered": payments_registered, "refunds_linked": refunds_linked, "cursor": cursor}


async def _sync_balances(session: AsyncSession, user: User, payload: dict | None) -> int:
    """Upsert one AccountBalance snapshot per mapped account for today. Balances
    are stored as positive magnitudes; net worth applies the sign by account type."""
    if not payload:
        return 0
    from sqlalchemy.dialects.postgresql import insert as pg_insert
    from app.models.accounts import AccountBalance

    accounts_by_id = await _accounts_by_plaid_id(session, user.household_id)
    today = date.today()
    written = 0
    for acct in payload.get("accounts", []):
        account_id = accounts_by_id.get(acct.get("account_id"))
        current = (acct.get("balances") or {}).get("current")
        if account_id is None or current is None:
            continue
        stmt = pg_insert(AccountBalance).values(
            household_id=user.household_id, account_id=account_id, as_of=today, balance=_money(abs(Decimal(str(current)))),
        ).on_conflict_do_update(
            constraint="account_balance_account_as_of_key",
            set_={"balance": _money(abs(Decimal(str(current))))},
        )
        await session.execute(stmt)
        written += 1
    return written


async def _sync_liabilities(session: AsyncSession, user: User, item: PlaidItem, payload: dict | None) -> int:
    """Upsert Plaid credit/student/mortgage liabilities into the loan table so they
    surface on the Debt page. Keyed on plaid_account_id, so re-syncs refresh the same
    loan. Returns the number of loans created or updated."""
    if not payload:
        return 0
    accounts_by_id = {a.get("account_id"): a for a in payload.get("accounts", [])}
    liabilities = payload.get("liabilities") or {}
    existing = {
        loan.plaid_account_id: loan
        for loan in (await session.execute(
            select(Loan).where(Loan.household_id == user.household_id, Loan.plaid_item_id == item.id)
        )).scalars().all()
    }
    synced = 0
    for kind in ("credit", "student", "mortgage"):
        for entry in liabilities.get(kind) or []:
            account = accounts_by_id.get(entry.get("account_id")) or {}
            mapped = _map_liability(kind, entry, account)
            if mapped is None:
                continue
            loan = existing.get(entry.get("account_id"))
            if loan is None:
                loan = Loan(household_id=user.household_id, owner_user_id=user.id, plaid_item_id=item.id, plaid_account_id=entry.get("account_id"))
                session.add(loan)
            for field, value in mapped["loan"].items():
                setattr(loan, field, value)
            loan.penalty_rules = loan.penalty_rules or {}
            loan.start_date = loan.start_date or date.today()
            await session.flush()
            if mapped.get("credit_card_detail") is not None:
                await _upsert_credit_card_detail(session, loan.id, mapped["credit_card_detail"])
            await loans_service.regenerate_schedule(session, user, loan)
            synced += 1
    return synced


def _map_liability(kind: str, entry: dict, account: dict) -> dict | None:
    """Translate one Plaid liability + its account into loan column values. Plaid
    reports the owed balance on the account (balances.current); per-product fields
    carry the rate, minimum payment, and due date."""
    balances = account.get("balances") or {}
    currency = _currency(balances.get("iso_currency_code") or account.get("iso_currency_code"))
    name = account.get("official_name") or account.get("name") or f"{kind.title()} account"
    principal = _money(balances.get("current"))
    due_day = _day_of(entry.get("next_payment_due_date"))
    if kind == "credit":
        loan = {
            "name": name, "type": "credit_card", "schedule_kind": "revolving",
            "principal": principal, "currency": currency,
            "interest_rate": _purchase_apr(entry.get("aprs")),
            "min_or_emi_amount": _money(entry.get("minimum_payment_amount")),
            "due_day": due_day,
        }
        detail = {
            "credit_limit": _money(balances.get("limit")),
            "statement_balance": _money(entry.get("last_statement_balance")) if entry.get("last_statement_balance") is not None else None,
            "available_credit": _money(balances.get("available")) if balances.get("available") is not None else None,
            "statement_day": _day_of(entry.get("last_statement_issue_date")),
        }
        return {"loan": loan, "credit_card_detail": detail}
    if kind == "student":
        return {"loan": {
            "name": name, "type": "education", "schedule_kind": "amortizing",
            "principal": principal, "currency": currency,
            "interest_rate": entry.get("interest_rate_percentage"),
            "min_or_emi_amount": _money(entry.get("minimum_payment_amount")),
            "due_day": due_day,
        }}
    if kind == "mortgage":
        rate = entry.get("interest_rate") or {}
        return {"loan": {
            "name": name, "type": "home", "schedule_kind": "amortizing",
            "principal": principal, "currency": currency,
            "interest_rate": rate.get("percentage"),
            "min_or_emi_amount": _money(entry.get("next_monthly_payment")) if entry.get("next_monthly_payment") is not None else None,
            "due_day": due_day,
        }}
    return None


async def _upsert_credit_card_detail(session: AsyncSession, loan_id: uuid.UUID, values: dict) -> None:
    detail = (await session.execute(
        select(CreditCardDetail).where(CreditCardDetail.loan_id == loan_id)
    )).scalar_one_or_none()
    if detail is None:
        detail = CreditCardDetail(loan_id=loan_id, **values)
        session.add(detail)
    else:
        for field, value in values.items():
            setattr(detail, field, value)


def _purchase_apr(aprs: list | None):
    """Pick the purchase APR from Plaid's apr list, falling back to the first one."""
    if not aprs:
        return None
    for apr in aprs:
        if (apr.get("apr_type") or "").lower() == "purchase_apr":
            return apr.get("apr_percentage")
    return aprs[0].get("apr_percentage")


def _day_of(value) -> int | None:
    if not value:
        return None
    try:
        return _date(value).day
    except Exception:  # noqa: BLE001
        return None


async def list_plaid_items(session: AsyncSession, user: User) -> list[dict]:
    items = list((await session.execute(
        select(PlaidItem).where(PlaidItem.household_id == user.household_id, PlaidItem.status == "active")
    )).scalars().all())
    out = []
    for item in items:
        count = (await session.execute(
            select(func.count()).select_from(AccountLogical).where(AccountLogical.plaid_item_id == item.id)
        )).scalar_one()
        out.append({
            "id": item.id,
            "institution_name": item.institution_name,
            "account_count": int(count),
            "status": item.status,
            "sync_cursor": item.sync_cursor,
        })
    return out


async def delete_plaid_item(session: AsyncSession, user: User, item_id: uuid.UUID, gateway=None) -> None:
    item = (await session.execute(select(PlaidItem).where(PlaidItem.id == item_id, PlaidItem.household_id == user.household_id))).scalar_one_or_none()
    if item is None:
        raise NotFound("Plaid item not found")
    token = decrypt_string(item.access_token_encrypted)
    if token and gateway is not None:
        await gateway.remove_item(token)
    item.status = "revoked"
    item.access_token_encrypted = None
    await record_consent(session, user, "plaid", granted=False)
    await session.commit()


async def splitwise_oauth_start(user: User, gateway) -> dict:
    from app.auth.security import create_oauth_state

    state = create_oauth_state(user.id, user.household_id)
    return {"authorization_url": gateway.authorization_url(state), "state": state}


async def splitwise_oauth_callback(session: AsyncSession, user: User, code: str, state: str, gateway) -> dict:
    if not state.startswith(str(user.id)):
        raise NotFound("OAuth state does not match user")
    token = await gateway.exchange_code(code)
    row = IngestionConnection(
        user_id=user.id,
        channel="splitwise",
        provider="splitwise",
        token_encrypted=encrypt_string(token.get("access_token") or ""),
        config={"token_meta": _safe_token_meta(token)},
        status="active",
    )
    session.add(row)
    await record_consent(session, user, "splitwise")
    await session.commit()
    await session.refresh(row)
    return {"connection_id": row.id, "status": row.status}


async def splitwise_sync(session: AsyncSession, user: User, gateway) -> dict:
    conn = (await session.execute(select(IngestionConnection).where(
        IngestionConnection.user_id == user.id,
        IngestionConnection.channel == "splitwise",
        IngestionConnection.status == "active",
    ))).scalars().first()
    if conn is None:
        raise NotFound("Splitwise connection not found")
    token = decrypt_string(conn.token_encrypted) or ""
    events = await gateway.get_balances(token)
    doc = Document(
        household_id=user.household_id,
        uploaded_by_user_id=user.id,
        storage_key=f"splitwise://{uuid.uuid4()}",
        type="other",
        source_channel="splitwise",
        status="processed",
        ocr_meta={"splitwise": {"events": events}},
    )
    session.add(doc)
    await session.commit()
    return {"events": events, "balances_count": len(events)}


async def splitwise_balances(session: AsyncSession, user: User) -> dict:
    """Latest synced Splitwise balances (read-only). Source of truth is the most
    recent splitwise document's ocr_meta."""
    stmt = (
        select(Document)
        .where(Document.household_id == user.household_id, Document.source_channel == "splitwise")
        .order_by(Document.created_at.desc())
        .limit(1)
    )
    doc = (await session.execute(stmt)).scalars().first()
    if doc is None:
        return {"balances": [], "synced_at": None}
    events = (doc.ocr_meta or {}).get("splitwise", {}).get("events", [])
    return {"balances": events, "synced_at": doc.created_at}


async def delete_splitwise_connection(session: AsyncSession, user: User) -> None:
    rows = list((await session.execute(select(IngestionConnection).where(
        IngestionConnection.user_id == user.id,
        IngestionConnection.channel == "splitwise",
    ))).scalars().all())
    for row in rows:
        row.status = "revoked"
        row.token_encrypted = None
    await record_consent(session, user, "splitwise", granted=False)
    await session.commit()


async def email_oauth_start(user: User, gateway: GmailGateway) -> dict:
    from app.auth.security import create_oauth_state

    state = create_oauth_state(user.id, user.household_id)
    return {"authorization_url": gateway.authorization_url(state), "state": state}


async def email_oauth_callback(session: AsyncSession, user: User, code: str, state: str, gateway: GmailGateway) -> dict:
    if not state.startswith(str(user.id)):
        raise NotFound("OAuth state does not match user")
    token = await gateway.exchange_code(code)
    row = IngestionConnection(user_id=user.id, channel="email", provider="gmail", token_encrypted=encrypt_string(token.get("refresh_token") or token.get("token") or ""), config={"scope": "gmail.readonly", "token_meta": _safe_token_meta(token)}, status="active")
    session.add(row)
    await record_consent(session, user, "email")
    await session.commit()
    await session.refresh(row)
    return {"connection_id": row.id, "status": row.status}


async def _ingest_email_attachments(session: AsyncSession, user: User, attachments: list[dict]) -> int:
    """Route each email attachment through the real document pipeline + OCR enqueue."""
    store = get_object_store()
    count = 0
    for att in attachments or []:
        raw_b64 = att.get("data_base64url")
        if not raw_b64:
            continue
        data = base64.urlsafe_b64decode(raw_b64 + "=" * (-len(raw_b64) % 4))
        try:
            doc = await doc_service.create_document(
                session, store,
                household_id=user.household_id,
                uploaded_by_user_id=user.id,
                file_bytes=data,
                filename=att.get("filename") or "attachment",
                content_type=att.get("mime_type"),
                channel="email",
            )
        except UnsupportedFile:
            continue  # skip unreadable attachments; do not fail the whole sync
        await session.commit()
        await session.refresh(doc)
        doc_service.enqueue_ocr(doc.id)
        count += 1
    return count


async def email_sync(session: AsyncSession, user: User, gateway: GmailGateway, llm: LLMClient | None = None) -> dict:
    conn = (await session.execute(select(IngestionConnection).where(IngestionConnection.user_id == user.id, IngestionConnection.channel == "email", IngestionConnection.status == "active"))).scalars().first()
    if conn is None:
        raise NotFound("Email connection not found")
    if llm is None:
        llm = await get_household_llm_client(session, user.household_id)
    token = decrypt_string(conn.token_encrypted) or ""
    messages = await gateway.fetch_messages(token)
    docs = 0
    attachments_ingested = 0
    txns_created = 0
    for msg in messages:
        payload = EmailInboundIn(**msg)
        # Deduplicate the provider message before creating any document or
        # attachment work.  Transaction-level dedup is too late: it still
        # repeats storage writes and OCR for every sync.
        message_key = payload.message_id or hashlib.sha256(
            f"{payload.from_address}\n{payload.subject or ''}\n{payload.body or ''}\n{payload.received_at or ''}".encode()
        ).hexdigest()
        payload = payload.model_copy(update={"message_id": message_key})
        existing = await session.scalar(
            select(Document.id).where(
                Document.household_id == user.household_id,
                Document.uploaded_by_user_id == user.id,
                Document.source_channel == "email",
                Document.ocr_meta["email"]["message_id"].astext == message_key,
            )
        )
        if existing is not None:
            continue
        doc = await create_email_document(session, user, payload)
        docs += 1
        ingested = await _ingest_email_attachments(session, user, payload.attachments)
        attachments_ingested += ingested
        if ingested:
            continue  # attachments go through OCR -> their own txn; don't double-count
        parsed = await _parse_email(payload, llm, user, session)
        if not parsed or not parsed.is_transaction or not parsed.amount:
            continue
        amount = _money(parsed.amount)
        if parsed.type != "credit":  # money out -> negative (canonical)
            amount = -amount
        external_seed = payload.message_id
        needs_review = (parsed.confidence or 0) < 0.75
        txn = await txn_service.create_transaction(session, user, TransactionCreate(
            merchant=parsed.merchant or payload.from_address,
            amount=amount,
            currency=_currency(parsed.currency),
            txn_date=_date(parsed.date or (payload.received_at.date() if payload.received_at else None)),
            status="draft",
            source_document_id=doc.id,
            source_channel="email",
            # Email subjects and bodies are untrusted raw mailbox content.  Keep
            # normalized transaction fields only; source metadata lives on the
            # minimal email document record rather than in transaction notes.
            notes="Imported from email",
            confidence=parsed.confidence,
            external_id=f"email:{conn.id}:{external_seed}",
        ))
        # Dedup on (source_channel, external_id) returns the earlier txn, which
        # points at the doc from the sync that created it — only count fresh rows.
        if txn.source_document_id == doc.id:
            txns_created += 1
            if needs_review:
                doc.status = "needs_review"
                await session.commit()
    return {"documents_created": docs, "attachments_ingested": attachments_ingested, "transactions_created": txns_created}


async def _parse_email(payload: EmailInboundIn, llm: LLMClient | None, user: User, session: AsyncSession) -> EmailParsed | None:
    """Extract a single transaction from an alert/receipt email body: LLM when
    configured, regex fallback otherwise. Returns None when it isn't one."""
    text = f"Subject: {payload.subject or ''}\nFrom: {payload.from_address}\n\n{(payload.body or '')[:4000]}"
    if llm is not None and get_settings().email_llm_processing_enabled:
        try:
            out = await llm.chat(
                [{"role": "user", "content": "Decide if this email describes a single money transaction (bank/card alert or merchant receipt). If yes set is_transaction=true and extract merchant, amount, ISO currency, date (YYYY-MM-DD), type debit|credit, confidence. Email:\n" + text}],
                json_schema=EmailParsed, purpose="email.parse", user_id=user.id, session=session,
            )
            return EmailParsed.model_validate(out)
        except Exception:  # noqa: BLE001 — fall back to regex, never fail the sync
            pass
    rx = _regex_sms(payload.body or "")
    if rx is None:
        return None
    return EmailParsed(is_transaction=True, merchant=rx.merchant, amount=rx.amount, currency=rx.currency, date=rx.date, type=rx.type, confidence=rx.confidence)


async def delete_email_connection(session: AsyncSession, user: User) -> None:
    rows = list((await session.execute(select(IngestionConnection).where(IngestionConnection.user_id == user.id, IngestionConnection.channel == "email"))).scalars().all())
    for row in rows:
        row.status = "revoked"
        row.token_encrypted = None
    await record_consent(session, user, "email", granted=False)
    await session.commit()


async def create_email_document(session: AsyncSession, user: User, data: EmailInboundIn) -> Document:
    # Store only the minimum metadata needed for review.  In particular, never
    # persist raw body text (including a preview) or attachment base64 in JSONB;
    # attachments that are explicitly accepted travel through the encrypted
    # document pipeline.
    doc = Document(
        household_id=user.household_id,
        uploaded_by_user_id=user.id,
        storage_key=f"email://{uuid.uuid4()}",
        type="statement" if data.attachments else "other",
        source_channel="email",
        status="uploaded",
        ocr_meta={
            "email": {
                "from_address": data.from_address,
                "subject": data.subject,
                "message_id": data.message_id,
                "received_at": data.received_at.isoformat() if data.received_at else None,
                "attachment_count": len(data.attachments),
            }
        },
    )
    session.add(doc)
    await record_consent(session, user, "email")
    await session.commit()
    await session.refresh(doc)
    return doc


async def rotate_sms_token(session: AsyncSession, user: User, allowed_senders: list[str] | None = None) -> dict:
    token = secrets.token_urlsafe(32)
    conn = IngestionConnection(user_id=user.id, channel="sms", provider="android-forwarder", token_encrypted=None, config={"token_hash": _hash(token), "allowed_senders": allowed_senders or []}, status="active")
    session.add(conn)
    await record_consent(session, user, "sms")
    await session.commit()
    return {"token": token, "webhook_url": "/webhooks/sms", "allowed_senders": allowed_senders or []}


async def delete_sms_connection(session: AsyncSession, user: User) -> None:
    rows = list((await session.execute(select(IngestionConnection).where(IngestionConnection.user_id == user.id, IngestionConnection.channel == "sms"))).scalars().all())
    for row in rows:
        row.status = "revoked"
    await record_consent(session, user, "sms", granted=False)
    await session.commit()


async def sms_webhook(session: AsyncSession, token: str, data: SmsWebhookIn, llm: LLMClient | None = None) -> dict:
    conn = await _sms_connection_by_token(session, token)
    user = await session.get(User, conn.user_id)
    if user is None:
        raise NotFound("SMS user not found")
    if llm is None:
        llm = await get_household_llm_client(session, user.household_id)
    allowed = (conn.config or {}).get("allowed_senders") or []
    if allowed and data.from_sender not in allowed:
        raise NotFound("SMS sender is not allowlisted")
    parsed = await _parse_sms(data.body, llm, user, session)
    confidence = parsed.confidence if parsed else 0.0
    needs_review = confidence < 0.75
    doc = Document(household_id=user.household_id, uploaded_by_user_id=user.id, storage_key=f"sms://{uuid.uuid4()}", type="other", source_channel="sms", status="needs_review" if needs_review else "processed", ocr_meta={"sms": data.model_dump(mode="json"), "ocr": {"doc_type": "sms", "data": parsed.model_dump(mode="json") if parsed else {}, "confidence": confidence, "needs_review": needs_review}})
    session.add(doc)
    await session.flush()
    txn = None
    if parsed:
        amount = _money(parsed.amount)
        if parsed.type != "credit":  # debit = money out -> negative (canonical)
            amount = -amount
        txn = await txn_service.create_transaction(session, user, TransactionCreate(merchant=parsed.merchant or data.from_sender, amount=amount, currency=parsed.currency, txn_date=_date(parsed.date), status="draft", source_document_id=doc.id, source_channel="sms", notes=data.body[:500], confidence=parsed.confidence, external_id=f"sms:{conn.id}:{hashlib.sha256((data.from_sender + data.body + str(data.received_at)).encode()).hexdigest()[:24]}"))
    await session.commit()
    return {"document_id": doc.id, "transaction_id": txn.id if txn else None, "confidence": parsed.confidence if parsed else 0.0, "status": doc.status}


async def _sms_connection_by_token(session: AsyncSession, token: str) -> IngestionConnection:
    # Look the token up by its hash directly in the DB instead of scanning every
    # active SMS connection in Python (O(n) per unauthenticated webhook hit). The
    # webhook is public, so this is on the abuse path — keep it a single indexed-ish
    # equality match on the stored sha256, not a linear walk.
    token_hash = _hash(token)
    row = (await session.execute(
        select(IngestionConnection).where(
            IngestionConnection.channel == "sms",
            IngestionConnection.status == "active",
            IngestionConnection.config["token_hash"].astext == token_hash,
        )
    )).scalars().first()
    if row is None:
        raise NotFound("Invalid SMS token")
    return row


async def _parse_sms(body: str, llm: LLMClient | None, user: User, session: AsyncSession) -> SmsParsed | None:
    if llm is not None:
        try:
            out = await llm.chat([{"role": "user", "content": f"Parse this bank SMS into merchant, amount, ISO currency, date, type debit|credit, confidence. SMS: {body}"}], json_schema=SmsParsed, purpose="sms.parse", user_id=user.id, session=session)
            return SmsParsed.model_validate(out)
        except Exception:
            pass
    return _regex_sms(body)


def _regex_sms(body: str) -> SmsParsed | None:
    import re
    amt = re.search(r"(?:INR|Rs\.?|₹|USD|\$)\s*([0-9,]+(?:\.\d{1,2})?)", body, re.I)
    if not amt:
        return None
    currency = "INR" if re.search(r"INR|Rs\.?|₹", body, re.I) else "USD"
    kind = "credit" if re.search(r"credited|received|deposit", body, re.I) else "debit"
    merchant = None
    m = re.search(r"(?:at|to|from)\s+([A-Za-z0-9 &._-]{3,40})", body)
    if m:
        merchant = m.group(1).strip()
    return SmsParsed(merchant=merchant, amount=Decimal(amt.group(1).replace(",", "")), currency=currency, date=None, type=kind, confidence=0.65)


async def _accounts_by_plaid_id(session: AsyncSession, household_id: uuid.UUID) -> dict[str, uuid.UUID]:
    rows = list((await session.execute(select(AccountLogical).where(AccountLogical.household_id == household_id, AccountLogical.plaid_account_id.is_not(None)))).scalars().all())
    return {row.plaid_account_id: row.id for row in rows if row.plaid_account_id}


def _account_type(kind: str | None, subtype: str | None) -> str:
    value = (subtype or kind or "").lower()
    if value in {"credit card", "credit"}:
        return "credit"
    if value in {"brokerage", "investment"}:
        return "investment"
    if value in {"savings"}:
        return "savings"
    if value in {"loan", "student", "mortgage"}:
        return "loan"
    if value in {"checking", "depository", ""}:
        return "checking"
    # Unmapped subtype (hsa/cd/401k/...) — Link filters should prevent this, but
    # if it arrives, label it honestly instead of pretending it's cash.
    return "other"


def _date(value: str | date | None) -> date:
    if isinstance(value, date):
        return value
    if value:
        return date.fromisoformat(str(value)[:10])
    return date.today()
