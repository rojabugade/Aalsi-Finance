"""Incremental Plaid sync: pagination, modified updates, removed deletion, and
merge-tombstone dedup. Covers the fixes to transactions/sync handling that make
first-sync of a real, multi-page account correct."""

from __future__ import annotations

import os
import uuid
from datetime import date
from decimal import Decimal

import pytest
import pytest_asyncio
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.ingestion.schemas import PlaidExchangeIn, PlaidSyncIn
from app.ingestion.service import plaid_exchange, plaid_sync
from app.models.core import Household, User
from app.models.transactions import Transaction
from app.transactions.service import merge_transactions

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL", "postgresql+asyncpg://finance:finance@localhost:5433/finance")
HOUSEHOLD_PREFIX = "pytest-plaidsync-"


def _txn(txn_id: str, amount: str, name: str = "STORE") -> dict:
    return {
        "transaction_id": txn_id, "account_id": "acc-1", "name": name,
        "merchant_name": name.title(), "amount": amount,
        "iso_currency_code": "USD", "date": "2026-06-01",
    }


class QueuePlaid:
    """Returns pre-scripted transactions/sync pages, one per call, so a test can
    drive multi-page drains and successive syncs deterministically."""

    def __init__(self, pages: list[dict]):
        self.pages = list(pages)
        self.calls = 0

    async def exchange_public_token(self, public_token: str) -> dict:
        return {"access_token": f"access-{public_token}"}

    async def sandbox_fire_default_update(self, access_token: str) -> None:
        return None

    async def get_liabilities(self, access_token: str) -> dict | None:
        return None

    async def get_accounts(self, access_token: str) -> dict | None:
        return None

    async def sync_transactions(self, access_token: str, cursor: str | None = None) -> dict:
        self.calls += 1
        return self.pages.pop(0)


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
    user = User(household_id=hh.id, email=f"{uuid.uuid4().hex}@example.com", password_hash="x", role="owner")
    session.add(user)
    await session.flush()
    return user


async def _linked_item(session, user, gateway) -> uuid.UUID:
    exchanged = await plaid_exchange(session, user, PlaidExchangeIn(
        public_token="public", institution_name="Sandbox",
        accounts=[{"account_id": "acc-1", "name": "Checking", "type": "depository", "subtype": "checking", "iso_currency_code": "USD", "mask": "0000"}],
    ), gateway)
    return exchanged["plaid_item_id"]


async def _plaid_txns(session, user):
    rows = (await session.execute(
        select(Transaction).where(Transaction.household_id == user.household_id, Transaction.source_channel == "plaid").order_by(Transaction.external_id)
    )).scalars().all()
    return list(rows)


@pytest.mark.asyncio
async def test_sync_drains_all_pages(session):
    user = await _user(session)
    gateway = QueuePlaid([
        {"next_cursor": "c1", "has_more": True, "added": [_txn("t1", "10.00")], "modified": [], "removed": []},
        {"next_cursor": "c2", "has_more": False, "added": [_txn("t2", "20.00")], "modified": [], "removed": []},
    ])
    item_id = await _linked_item(session, user, gateway)
    result = await plaid_sync(session, user, PlaidSyncIn(plaid_item_id=item_id), gateway)
    assert gateway.calls == 2  # followed has_more instead of truncating
    assert result["transactions_created"] == 2
    assert result["cursor"] == "c2"
    assert len(await _plaid_txns(session, user)) == 2


@pytest.mark.asyncio
async def test_modified_updates_existing_in_place(session):
    user = await _user(session)
    add = QueuePlaid([{"next_cursor": "c1", "has_more": False, "added": [_txn("t1", "10.00")], "modified": [], "removed": []}])
    item_id = await _linked_item(session, user, add)
    await plaid_sync(session, user, PlaidSyncIn(plaid_item_id=item_id), add)

    modify = QueuePlaid([{"next_cursor": "c2", "has_more": False, "added": [], "modified": [_txn("t1", "99.99")], "removed": []}])
    result = await plaid_sync(session, user, PlaidSyncIn(plaid_item_id=item_id), modify)
    assert result["transactions_updated"] == 1

    txns = await _plaid_txns(session, user)
    assert len(txns) == 1  # updated, not duplicated
    assert txns[0].amount == Decimal("-99.99")  # Plaid positive outflow -> stored negative


@pytest.mark.asyncio
async def test_removed_deletes_transaction(session):
    user = await _user(session)
    add = QueuePlaid([{"next_cursor": "c1", "has_more": False, "added": [_txn("t1", "10.00")], "modified": [], "removed": []}])
    item_id = await _linked_item(session, user, add)
    await plaid_sync(session, user, PlaidSyncIn(plaid_item_id=item_id), add)

    remove = QueuePlaid([{"next_cursor": "c2", "has_more": False, "added": [], "modified": [], "removed": [{"transaction_id": "t1"}]}])
    result = await plaid_sync(session, user, PlaidSyncIn(plaid_item_id=item_id), remove)
    assert result["transactions_removed"] == 1
    assert len(await _plaid_txns(session, user)) == 0


@pytest.mark.asyncio
async def test_merge_tombstone_prevents_resync_duplicate(session):
    user = await _user(session)
    add = QueuePlaid([{"next_cursor": "c1", "has_more": False, "added": [_txn("t1", "10.00"), _txn("t2", "20.00")], "modified": [], "removed": []}])
    item_id = await _linked_item(session, user, add)
    await plaid_sync(session, user, PlaidSyncIn(plaid_item_id=item_id), add)

    txns = await _plaid_txns(session, user)
    assert len(txns) == 2
    survivor = await merge_transactions(session, user, [t.id for t in txns], notes="merged")
    assert "plaid::t2" in (survivor.flags or {}).get("merged_external_ids", [])
    assert len(await _plaid_txns(session, user)) == 1  # t2 swallowed

    # Plaid re-delivers the swallowed txn: dedup must resolve to the survivor.
    resync = QueuePlaid([{"next_cursor": "c2", "has_more": False, "added": [_txn("t2", "20.00")], "modified": [], "removed": []}])
    await plaid_sync(session, user, PlaidSyncIn(plaid_item_id=item_id), resync)
    assert len(await _plaid_txns(session, user)) == 1  # no duplicate re-created
