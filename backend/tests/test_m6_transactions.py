from __future__ import annotations

import os
import uuid
from datetime import date
from decimal import Decimal

import pytest
import pytest_asyncio
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models.core import Household, User
from app.models.documents import Document
from app.models.transactions import Category, LineItem, Rule, Transaction
from app.ocr.schemas import ExtractionResult
from app.transactions.ingest import ingest_extraction
from app.transactions.schemas import TransactionPatch
from app.transactions.service import get_or_create_merchant, patch_transaction

TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://finance:finance@localhost:5433/finance",
)

HOUSEHOLD_PREFIX = "pytest-m6-"


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
    user = User(
        household_id=hh.id,
        email=f"{uuid.uuid4().hex}@example.com",
        password_hash="x",
    )
    session.add(user)
    await session.flush()
    return user


@pytest.mark.asyncio
async def test_receipt_reconciles_into_statement_without_double_count(session):
    user = await _user(session)
    statement_doc = Document(
        household_id=user.household_id,
        uploaded_by_user_id=user.id,
        storage_key="x/stmt.pdf",
        type="statement",
        source_channel="upload",
    )
    receipt_doc = Document(
        household_id=user.household_id,
        uploaded_by_user_id=user.id,
        storage_key="x/receipt.jpg",
        type="receipt",
        source_channel="upload",
    )
    session.add_all([statement_doc, receipt_doc])
    await session.flush()

    await ingest_extraction(
        session,
        statement_doc.id,
        ExtractionResult(
            doc_type="statement",
            data={"transactions": [{"date": "2026-01-03", "description": "MACYS", "amount": "214.30", "confidence": 0.9}]},
            confidence=0.9,
            needs_review=False,
            summary={},
            engine={},
        ),
    )
    await ingest_extraction(
        session,
        receipt_doc.id,
        ExtractionResult(
            doc_type="receipt",
            data={
                "merchant": "Macy's",
                "date": "2026-01-01",
                "currency": "USD",
                "total": "214.30",
                "line_items": [
                    {"name": "Pants", "amount": "90.00", "qty": 3, "confidence": 0.9},
                    {"name": "Tops", "amount": "74.00", "qty": 3, "confidence": 0.9},
                    {"name": "Cosmetics", "amount": "50.30", "qty": 4, "confidence": 0.9},
                ],
            },
            confidence=0.92,
            needs_review=False,
            summary={},
            engine={},
        ),
    )

    txn_count = await session.scalar(select(func.count()).select_from(Transaction).where(Transaction.household_id == user.household_id))
    item_count = await session.scalar(select(func.count()).select_from(LineItem))
    assert txn_count == 1
    assert item_count == 3
    txn = (await session.execute(select(Transaction).where(Transaction.household_id == user.household_id))).scalar_one()
    assert txn.amount == Decimal("214.30")
    assert txn.flags["linked_receipt_document_ids"] == [str(receipt_doc.id)]


@pytest.mark.asyncio
async def test_category_correction_creates_reusable_rule(session):
    user = await _user(session)
    cat = Category(household_id=user.household_id, name="Clothing", kind="category")
    session.add(cat)
    await session.flush()
    merchant = await get_or_create_merchant(session, user.household_id, "Macys")
    txn = Transaction(
        household_id=user.household_id,
        owner_user_id=user.id,
        merchant_id=merchant.id,
        amount=Decimal("10.00"),
        currency="USD",
        base_amount=Decimal("10.00"),
        fx_rate=Decimal("1"),
        txn_date=date(2026, 1, 1),
        status="draft",
        flags={},
    )
    session.add(txn)
    await session.flush()

    await patch_transaction(session, user, txn.id, TransactionPatch(category_id=cat.id))

    rule = (await session.execute(select(Rule).where(Rule.household_id == user.household_id))).scalar_one()
    assert rule.matcher == {"field": "merchant", "op": "eq", "value": merchant.canonical_name}
    assert rule.action == {"set_category": str(cat.id)}


@pytest.mark.asyncio
async def test_plaid_pfc_fallback_categorizes(session):
    from app.transactions import service as txn_service
    from app.transactions.schemas import TransactionCreate

    user = await _user(session)
    cat = Category(household_id=user.household_id, name="Food & Dining", kind="category")
    session.add(cat)
    await session.commit()
    txn = await txn_service.create_transaction(session, user, TransactionCreate(
        merchant=f"unseen-merchant-{uuid.uuid4().hex[:6]}", amount=Decimal("-23.45"), currency="USD",
        txn_date=date(2026, 6, 20), status="draft", source_channel="plaid",
        external_id=f"t-pfc-{uuid.uuid4().hex[:6]}",
        flags={"plaid_pfc": {"primary": "FOOD_AND_DRINK", "detailed": "FOOD_AND_DRINK_RESTAURANT"}},
    ))
    assert txn.category_id == cat.id


@pytest.mark.asyncio
async def test_overlong_merchant_name_is_truncated_not_rejected(session):
    """Real Plaid transaction descriptors can exceed the 255-char merchant column.
    The sync must not 500 (StringDataRightTruncationError); the name is capped."""
    user = await _user(session)
    long_name = "REMITLY " + "X" * 400  # > 255 chars
    merchant = await get_or_create_merchant(session, user.household_id, long_name)
    assert merchant is not None
    assert len(merchant.canonical_name) <= 255
    # A second call with the same overlong name must resolve to the same row.
    again = await get_or_create_merchant(session, user.household_id, long_name)
    assert again.id == merchant.id
