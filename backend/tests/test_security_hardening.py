"""Regression tests for the backend security-audit fixes.

Covers the cross-tenant and role-gating remediations that don't need MinIO/LLM:

- transaction create/patch reject FK ids (account, category, source document)
  belonging to another household;
- category creation is always household-scoped (no tenant-minted system categories);
- category merge refuses system categories and only rewrites the caller's own rows;
- household-wide settings (base currency / LLM config) are owner-only.

Skips when no Postgres is reachable, mirroring the other DB-backed suites.
"""

from __future__ import annotations

import os
import uuid
from datetime import date
from decimal import Decimal

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.data_controls import service as dc_service
from app.data_controls.schemas import SettingsPatch
from app.models.accounts import AccountLogical
from app.models.core import Household, User
from app.models.documents import Document
from app.models.transactions import Category, LineItem, Transaction
from app.transactions import service as txn_service
from app.transactions.schemas import CategoryIn, LineItemIn, TransactionCreate, TransactionPatch

TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://finance:finance@localhost:5433/finance",
)

HOUSEHOLD_PREFIX = "pytest-sec-"


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
        await conn.execute(text("DELETE FROM category WHERE name LIKE :p"), {"p": f"{HOUSEHOLD_PREFIX}%"})
    await eng.dispose()


@pytest_asyncio.fixture
async def session(engine):
    sm = async_sessionmaker(engine, expire_on_commit=False)
    async with sm() as s:
        yield s


async def _user(session, role: str = "owner") -> User:
    hh = Household(name=f"{HOUSEHOLD_PREFIX}{uuid.uuid4().hex[:8]}", base_currency="USD")
    session.add(hh)
    await session.flush()
    user = User(
        household_id=hh.id,
        email=f"{uuid.uuid4().hex}@example.com",
        password_hash="x",
        role=role,
    )
    session.add(user)
    await session.flush()
    return user


def _txn(**over) -> TransactionCreate:
    base = dict(amount=Decimal("-10.00"), currency="USD", txn_date=date(2026, 1, 1), status="draft")
    base.update(over)
    return TransactionCreate(**base)


@pytest.mark.asyncio
async def test_create_transaction_rejects_foreign_account(session):
    attacker = await _user(session)
    victim = await _user(session)
    foreign = AccountLogical(household_id=victim.household_id, label="Victim checking", type="checking", currency="USD")
    session.add(foreign)
    await session.flush()

    with pytest.raises(txn_service.NotFound):
        await txn_service.create_transaction(session, attacker, _txn(account_id=foreign.id))


@pytest.mark.asyncio
async def test_create_transaction_rejects_foreign_category_and_document(session):
    attacker = await _user(session)
    victim = await _user(session)
    v_cat = Category(household_id=victim.household_id, name=f"{HOUSEHOLD_PREFIX}vcat", kind="category")
    v_doc = Document(household_id=victim.household_id, storage_key=f"x/{uuid.uuid4()}", type="other", source_channel="upload")
    session.add_all([v_cat, v_doc])
    await session.flush()

    with pytest.raises(txn_service.NotFound):
        await txn_service.create_transaction(session, attacker, _txn(category_id=v_cat.id))
    with pytest.raises(txn_service.NotFound):
        await txn_service.create_transaction(session, attacker, _txn(source_document_id=v_doc.id))
    # A line item pointing at a foreign category is rejected too.
    with pytest.raises(txn_service.NotFound):
        await txn_service.create_transaction(
            session, attacker, _txn(line_items=[LineItemIn(name="x", amount=Decimal("-10.00"), item_type_category_id=v_cat.id)])
        )


@pytest.mark.asyncio
async def test_patch_transaction_rejects_foreign_category(session):
    attacker = await _user(session)
    victim = await _user(session)
    v_cat = Category(household_id=victim.household_id, name=f"{HOUSEHOLD_PREFIX}vcat2", kind="category")
    session.add(v_cat)
    await session.flush()
    txn = await txn_service.create_transaction(session, attacker, _txn())

    with pytest.raises(txn_service.NotFound):
        await txn_service.patch_transaction(session, attacker, txn.id, TransactionPatch(category_id=v_cat.id))


@pytest.mark.asyncio
async def test_create_category_is_never_system(session):
    owner = await _user(session)
    # Even if a caller tries, categories created via the tenant API stay scoped.
    cat = await txn_service.create_category(session, owner, CategoryIn(name=f"{HOUSEHOLD_PREFIX}mine"))
    assert cat.household_id == owner.household_id
    assert cat.is_system is False


@pytest.mark.asyncio
async def test_merge_category_refuses_system_source(session):
    owner = await _user(session)
    system = Category(household_id=None, name=f"{HOUSEHOLD_PREFIX}sys", kind="category", is_system=True)
    own = Category(household_id=owner.household_id, name=f"{HOUSEHOLD_PREFIX}own", kind="category")
    session.add_all([system, own])
    await session.flush()

    # Merging a global/system category is not allowed (would corrupt every tenant).
    with pytest.raises(txn_service.NotFound):
        await txn_service.merge_category(session, owner, system.id, own.id)
    with pytest.raises(txn_service.NotFound):
        await txn_service.merge_category(session, owner, own.id, system.id)


@pytest.mark.asyncio
async def test_merge_category_only_touches_own_household(session):
    owner = await _user(session)
    other = await _user(session)
    src = Category(household_id=owner.household_id, name=f"{HOUSEHOLD_PREFIX}src", kind="category")
    dst = Category(household_id=owner.household_id, name=f"{HOUSEHOLD_PREFIX}dst", kind="category")
    session.add_all([src, dst])
    await session.flush()

    mine = await txn_service.create_transaction(session, owner, _txn(category_id=src.id))
    # Another household happens to reference the same category id value is impossible
    # (ids are unique), so assert the merge leaves other households' rows untouched by
    # checking a foreign txn keeps its own category.
    other_cat = Category(household_id=other.household_id, name=f"{HOUSEHOLD_PREFIX}oc", kind="category")
    session.add(other_cat)
    await session.flush()
    theirs = await txn_service.create_transaction(session, other, _txn(category_id=other_cat.id))

    await txn_service.merge_category(session, owner, src.id, dst.id)

    await session.refresh(mine)
    await session.refresh(theirs)
    assert mine.category_id == dst.id
    assert theirs.category_id == other_cat.id
    # Source category is gone.
    assert (await session.get(Category, src.id)) is None


@pytest.mark.asyncio
async def test_patch_settings_household_wide_is_owner_only(session):
    viewer = await _user(session, role="viewer")

    # Per-user preference is fine for any role.
    await dc_service.patch_settings(session, viewer, SettingsPatch(language="hi"))

    for payload in (SettingsPatch(base_currency="INR"), SettingsPatch(llm_base_url="http://evil.example/v1")):
        with pytest.raises(HTTPException) as exc:
            await dc_service.patch_settings(session, viewer, payload)
        assert exc.value.status_code == 403

    owner = await _user(session, role="owner")
    out = await dc_service.patch_settings(session, owner, SettingsPatch(base_currency="INR"))
    assert out["base_currency"] == "INR"
