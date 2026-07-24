from __future__ import annotations

import os
import uuid
from datetime import date
from decimal import Decimal

import pytest
import pytest_asyncio
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.ingestion import service
from app.ingestion.crypto import encrypt_string
from app.ingestion.schemas import EmailInboundIn, PlaidExchangeIn, PlaidSyncIn, SmsWebhookIn
from app.ingestion.service import create_email_document, plaid_exchange, plaid_sync, rotate_sms_token, sms_webhook
from app.models.accounts import PlaidItem
from app.models.core import Household, User
from app.models.documents import Document
from app.models.fx import FXRate
from app.models.ingestion import IngestionConnection
from app.models.transactions import Transaction


def test_account_type_unknown_maps_to_other():
    assert service._account_type(None, "hsa") == "other"
    assert service._account_type(None, "cd") == "other"
    assert service._account_type("depository", "checking") == "checking"
    assert service._account_type("credit", "credit card") == "credit"


TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL", "postgresql+asyncpg://finance:finance@localhost:5433/finance")
HOUSEHOLD_PREFIX = "pytest-m11-"


class FakePlaid:
    async def exchange_public_token(self, public_token: str) -> dict:
        return {"access_token": f"access-{public_token}"}

    async def sandbox_fire_default_update(self, access_token: str) -> None:
        return None

    async def sync_transactions(self, access_token: str, cursor: str | None = None) -> dict:
        return {"next_cursor": "cursor-1", "has_more": False, "added": [{"transaction_id": "txn-1", "account_id": "acc-1", "name": "STORE", "merchant_name": "Store", "amount": "12.34", "iso_currency_code": "USD", "date": "2026-06-01", "personal_finance_category": {"primary": "FOOD_AND_DRINK", "detailed": "FOOD_AND_DRINK_RESTAURANT"}}], "modified": [], "removed": []}

    async def get_liabilities(self, access_token: str) -> dict | None:
        return None

    async def get_accounts(self, access_token: str) -> dict | None:
        return {"accounts": [{"account_id": "acc-1", "balances": {"current": 1500.55, "iso_currency_code": "USD"}}]}


@pytest_asyncio.fixture
async def engine():
    eng = create_async_engine(TEST_DATABASE_URL)
    try:
        async with eng.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception as exc:  # noqa: BLE001
        await eng.dispose()
        pytest.skip(f"no Postgres at {TEST_DATABASE_URL}: {exc}")
    yield eng
    async with eng.begin() as conn:
        await conn.execute(text("DELETE FROM household WHERE name LIKE :p"), {"p": f"{HOUSEHOLD_PREFIX}%"})
    await eng.dispose()


@pytest_asyncio.fixture
async def session(engine):
    sm = async_sessionmaker(engine, expire_on_commit=False)
    async with sm() as s:
        yield s


async def _user(session):
    hh = Household(name=f"{HOUSEHOLD_PREFIX}{uuid.uuid4().hex[:8]}", base_currency="USD")
    session.add(hh)
    await session.flush()
    user = User(household_id=hh.id, email=f"{uuid.uuid4().hex}@example.com", password_hash="x")
    session.add(user)
    await session.merge(FXRate(currency_pair="USD/INR", date=date(2026, 6, 14), rate=Decimal("83.00")))
    await session.flush()
    return user


@pytest.mark.asyncio
async def test_plaid_email_and_sms_ingestion(session):
    user = await _user(session)
    exchanged = await plaid_exchange(session, user, PlaidExchangeIn(public_token="public", institution_name="Sandbox", accounts=[{"id": "acc-1", "name": "Checking", "type": "depository", "subtype": "checking", "iso_currency_code": "USD", "mask": "0000"}]), FakePlaid())
    assert exchanged["accounts_created"] == 1
    synced = await plaid_sync(session, user, PlaidSyncIn(plaid_item_id=exchanged["plaid_item_id"]), FakePlaid())
    assert synced["transactions_created"] == 1
    item = await session.get(PlaidItem, exchanged["plaid_item_id"])
    assert item.sync_cursor == "cursor-1"
    txn = (await session.execute(select(Transaction).where(Transaction.external_id == "txn-1"))).scalar_one()
    assert txn.account_id is not None

    email_doc = await create_email_document(
        session,
        user,
        EmailInboundIn(
            from_address="bank@example.com",
            subject="Statement",
            body="Your statement is ready",
            message_id="message-1",
            attachments=[{"filename": "statement.pdf", "data_base64url": "sensitive"}],
        ),
    )
    assert email_doc.source_channel == "email"
    assert email_doc.ocr_meta["email"] == {
        "from_address": "bank@example.com",
        "subject": "Statement",
        "message_id": "message-1",
        "received_at": None,
        "attachment_count": 1,
    }
    assert "Your statement is ready" not in str(email_doc.ocr_meta)
    assert "sensitive" not in str(email_doc.ocr_meta)

    token = await rotate_sms_token(session, user, ["BANK"])
    sms = await sms_webhook(session, token["token"], SmsWebhookIn(**{"from": "BANK", "body": "Rs. 1,200 debited at DMart"}), llm=None)
    assert sms["transaction_id"] is not None
    assert sms["status"] == "needs_review"
    assert await session.scalar(select(func.count()).select_from(Document).where(Document.household_id == user.household_id)) >= 3
    assert await session.scalar(select(func.count()).select_from(Transaction).where(Transaction.household_id == user.household_id)) >= 2


async def _connect_email(session, user):
    conn = IngestionConnection(
        user_id=user.id, channel="email", provider="gmail",
        token_encrypted=encrypt_string("t"), status="active",
    )
    session.add(conn)
    await session.flush()
    return conn


@pytest.mark.asyncio
async def test_plaid_amounts_negated_and_pfc_flagged(session):
    user = await _user(session)
    await plaid_exchange(session, user, PlaidExchangeIn(public_token="pt", institution_name="Bank", accounts=[{"account_id": "acc-1", "name": "Chk", "type": "depository", "subtype": "checking", "mask": "0000"}]), FakePlaid())
    await plaid_sync(session, user, PlaidSyncIn(), FakePlaid())
    txn = (await session.execute(select(Transaction).where(Transaction.household_id == user.household_id, Transaction.external_id == "txn-1"))).scalar_one()
    assert txn.amount == Decimal("-12.34")  # Plaid positive outflow -> stored negative
    assert (txn.flags or {}).get("plaid_pfc", {}).get("primary") == "FOOD_AND_DRINK"


@pytest.mark.asyncio
async def test_plaid_sync_writes_balance_snapshots(session):
    user = await _user(session)
    await plaid_exchange(session, user, PlaidExchangeIn(public_token="pt", institution_name="Bank", accounts=[{"account_id": "acc-1", "name": "Chk", "type": "depository", "subtype": "checking"}]), FakePlaid())
    out = await plaid_sync(session, user, PlaidSyncIn(), FakePlaid())
    assert out["balances_written"] == 1
    from app.models.accounts import AccountBalance, AccountLogical
    acct = (await session.execute(select(AccountLogical).where(AccountLogical.household_id == user.household_id))).scalars().first()
    bal = (await session.execute(select(AccountBalance).where(AccountBalance.account_id == acct.id))).scalar_one()
    assert bal.balance == Decimal("1500.55")
    # re-sync same day upserts, doesn't duplicate
    out2 = await plaid_sync(session, user, PlaidSyncIn(), FakePlaid())
    count = (await session.execute(select(func.count()).select_from(AccountBalance).where(AccountBalance.account_id == acct.id))).scalar_one()
    assert count == 1


@pytest.mark.asyncio
async def test_email_sync_ingests_attachment_as_document(session, monkeypatch):
    import base64

    user = await _user(session)
    await _connect_email(session, user)

    png = bytes.fromhex("89504e470d0a1a0a") + b"\x00" * 16  # PNG magic + filler
    b64 = base64.urlsafe_b64encode(png).decode().rstrip("=")

    class FakeGmail:
        async def fetch_messages(self, token):
            return [{
                "from_address": "bank@example.com", "subject": "Receipt", "body": "hi",
                "attachments": [{"filename": "r.png", "mime_type": "image/png", "data_base64url": b64}],
            }]

    enqueued = []
    monkeypatch.setattr("app.documents.service.enqueue_ocr", lambda doc_id: enqueued.append(doc_id))

    result = await service.email_sync(session, user, FakeGmail())
    assert result["attachments_ingested"] == 1
    assert len(enqueued) == 1

    docs = (await session.execute(
        select(Document).where(
            Document.household_id == user.household_id,
            Document.source_channel == "email",
            Document.type != "other",
        )
    )).scalars().all()
    assert any(d.status == "uploaded" for d in docs)


@pytest.mark.asyncio
async def test_email_sync_parses_body_into_draft_transaction(session):
    user = await _user(session)
    await _connect_email(session, user)

    class FakeGmail:
        async def fetch_messages(self, token):
            return [{
                "message_id": "gm-1",
                "from_address": "alerts@bank.com",
                "subject": "Card charged",
                "body": "Your card was charged $23.45 at STARBUCKS on 2026-06-20",
                "received_at": "2026-06-20T10:00:00+00:00",
                "attachments": [],
            }]

    out = await service.email_sync(session, user, FakeGmail())
    assert out["transactions_created"] == 1
    txn = (await session.execute(select(Transaction).where(Transaction.household_id == user.household_id, Transaction.source_channel == "email"))).scalar_one()
    assert txn.amount == Decimal("-23.45")
    assert txn.status == "draft"
    assert txn.external_id.startswith("email:")
    assert txn.notes == "Imported from email"
    assert "STARBUCKS" not in txn.notes
    # second sync of the same message dedups
    out2 = await service.email_sync(session, user, FakeGmail())
    assert out2["transactions_created"] == 0
    assert out2["documents_created"] == 0
