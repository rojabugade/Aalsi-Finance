from __future__ import annotations

import os
import uuid
from datetime import date
from decimal import Decimal

import pytest
import pytest_asyncio
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.analytics.schemas import BudgetIn
from app.analytics.service import breakdown, create_budget, list_budgets, recommendations, summary, timeseries
from app.models.core import Household, User
from app.models.guidance import Notification
from app.models.transactions import Category, LineItem, Transaction
from app.transactions.schemas import TransactionCreate
from app.transactions.service import confirm_transaction, create_transaction, get_or_create_merchant

TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://finance:finance@localhost:5433/finance",
)

HOUSEHOLD_PREFIX = "pytest-m7-"


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
        role="owner",
    )
    session.add(user)
    await session.flush()
    return user


@pytest.mark.asyncio
async def test_faceted_macy_item_breakdown_budget_and_recommendations(session):
    user = await _user(session)
    clothing = Category(household_id=user.household_id, name="Clothing", kind="category")
    session.add(clothing)
    await session.flush()
    merchant = await get_or_create_merchant(session, user.household_id, "Macy's")
    txn = Transaction(
        household_id=user.household_id,
        owner_user_id=user.id,
        merchant_id=merchant.id,
        amount=Decimal("214.30"),
        currency="USD",
        base_amount=Decimal("214.30"),
        fx_rate=Decimal("1"),
        txn_date=date(2026, 2, 12),
        category_id=clothing.id,
        status="confirmed",
        flags={},
    )
    session.add(txn)
    await session.flush()
    session.add_all(
        [
            LineItem(transaction_id=txn.id, name="Pants", amount=Decimal("90.00"), quantity=3),
            LineItem(transaction_id=txn.id, name="Tops", amount=Decimal("74.00"), quantity=3),
            LineItem(transaction_id=txn.id, name="Cosmetics", amount=Decimal("50.30"), quantity=4),
        ]
    )

    today = date.today()
    spike_txn = Transaction(
        household_id=user.household_id,
        owner_user_id=user.id,
        merchant_id=merchant.id,
        amount=Decimal("120.00"),
        currency="USD",
        base_amount=Decimal("120.00"),
        fx_rate=Decimal("1"),
        txn_date=today,
        category_id=clothing.id,
        status="confirmed",
        flags={},
    )
    session.add(spike_txn)
    await session.commit()

    result = await summary(
        session,
        user,
        date(2026, 1, 1),
        date(2026, 3, 31),
        ["merchant", "item_type"],
        compare="prev",
    )
    assert result["total"] == Decimal("214.30")
    assert {row["dimensions"]["item_type"]: row["total"] for row in result["rows"]} == {
        "Pants": Decimal("90.00"),
        "Tops": Decimal("74.00"),
        "Cosmetics": Decimal("50.30"),
    }

    budget = await create_budget(
        session,
        user,
        BudgetIn(category_id=clothing.id, period="monthly", amount=Decimal("50.00"), currency="USD"),
    )
    assert budget["overspent"] is True
    assert budget["spent"] >= Decimal("120.00")
    assert (await session.scalar(select(func.count()).select_from(Notification).where(Notification.type == "budget_overspend"))) == 1

    recs = await recommendations(session, user)
    assert recs
    assert any(str(spike_txn.id) in rec.supporting_refs["transaction_ids"] for rec in recs)
    assert (await list_budgets(session, user))[0]["progress_pct"] >= Decimal("100.00")


@pytest.mark.asyncio
async def test_timeseries_rollup_and_live_agree(session):
    """Confirm refreshes the rollup MV; month-aligned timeseries reads it and a
    partial-month window reads the live path — both must return identical numbers,
    including flag-based income classification."""
    user = await _user(session)
    await session.commit()

    spend = await create_transaction(
        session, user,
        TransactionCreate(merchant="StoreA", amount=Decimal("100.00"), currency="USD",
                          txn_date=date(2026, 1, 10), status="draft"),
    )
    income = await create_transaction(
        session, user,
        TransactionCreate(merchant="EmployerX", amount=Decimal("500.00"), currency="USD",
                          txn_date=date(2026, 1, 15), status="draft", flags={"type": "income"}),
    )
    # Draft transactions must not appear; only confirmed ones feed analytics.
    pre = await timeseries(session, user, "net", "monthly", date(2026, 1, 1), date(2026, 1, 31))
    assert pre["points"] == []

    await confirm_transaction(session, user, spend.id)
    await confirm_transaction(session, user, income.id)

    # Month-aligned -> rollup path; income (500) - spend (100) = 400 net.
    mv = await timeseries(session, user, "net", "monthly", date(2026, 1, 1), date(2026, 1, 31))
    assert mv["points"] == [{"period": "2026-01", "net": Decimal("400.00")}]
    # Both txns fall before the 20th, so the partial (live) window matches.
    live = await timeseries(session, user, "net", "monthly", date(2026, 1, 1), date(2026, 1, 20))
    assert live["points"] == mv["points"]
    spend_only = await timeseries(session, user, "spend", "monthly", date(2026, 1, 1), date(2026, 1, 31))
    assert spend_only["points"] == [{"period": "2026-01", "spend": Decimal("100.00")}]


@pytest.mark.asyncio
async def test_breakdown_excludes_income_category_transactions(session):
    user = await _user(session)
    income = Category(household_id=user.household_id, name="Income", kind="category")
    groceries = Category(household_id=user.household_id, name="Groceries", kind="category")
    session.add_all([income, groceries])
    await session.flush()
    salary = Category(household_id=user.household_id, parent_id=income.id, name="Salary", kind="subcategory")
    session.add(salary)
    await session.flush()

    paycheck = await get_or_create_merchant(session, user.household_id, "Paycheck - Acme Corp")
    store = await get_or_create_merchant(session, user.household_id, "Trader Joe's")
    session.add_all([
        Transaction(
            household_id=user.household_id,
            owner_user_id=user.id,
            merchant_id=paycheck.id,
            amount=Decimal("1000.00"),
            currency="USD",
            base_amount=Decimal("1000.00"),
            fx_rate=Decimal("1"),
            txn_date=date(2026, 1, 10),
            category_id=salary.id,
            status="confirmed",
            flags={},
        ),
        Transaction(
            household_id=user.household_id,
            owner_user_id=user.id,
            merchant_id=store.id,
            amount=Decimal("-42.50"),
            currency="USD",
            base_amount=Decimal("-42.50"),
            fx_rate=Decimal("1"),
            txn_date=date(2026, 1, 11),
            category_id=groceries.id,
            status="confirmed",
            flags={},
        ),
    ])
    await session.commit()

    result = await breakdown(session, user, "merchant", None, date(2026, 1, 1), date(2026, 1, 31))
    totals = {row["dimensions"]["merchant"]: row["total"] for row in result["rows"]}
    assert totals == {"Trader Joe's": Decimal("42.50")}


@pytest.mark.asyncio
async def test_budget_spend_includes_child_categories_and_line_items(session):
    user = await _user(session)
    food = Category(household_id=user.household_id, name="Food & Dining", kind="category")
    restaurants = Category(household_id=user.household_id, parent_id=food.id, name="Restaurants", kind="subcategory")
    groceries = Category(household_id=user.household_id, name="Groceries", kind="category")
    session.add_all([food, restaurants, groceries])
    await session.flush()
    merchant = await get_or_create_merchant(session, user.household_id, "Mixed Market")
    today = date.today()
    session.add_all(
        [
            Transaction(
                household_id=user.household_id,
                owner_user_id=user.id,
                merchant_id=merchant.id,
                amount=Decimal("-42.00"),
                currency="USD",
                base_amount=Decimal("-42.00"),
                fx_rate=Decimal("1"),
                txn_date=today,
                category_id=restaurants.id,
                status="confirmed",
                flags={},
            ),
            Transaction(
                household_id=user.household_id,
                owner_user_id=user.id,
                merchant_id=merchant.id,
                amount=Decimal("-30.00"),
                currency="USD",
                base_amount=Decimal("-30.00"),
                fx_rate=Decimal("1"),
                txn_date=today,
                category_id=groceries.id,
                status="confirmed",
                flags={},
            ),
        ]
    )
    await session.flush()
    grocery_txn = (
        await session.execute(
            select(Transaction).where(
                Transaction.household_id == user.household_id,
                Transaction.category_id == groceries.id,
            )
        )
    ).scalar_one()
    session.add_all(
        [
            LineItem(transaction_id=grocery_txn.id, name="Prepared food", item_type_category_id=restaurants.id, amount=Decimal("12.50"), quantity=1),
            LineItem(transaction_id=grocery_txn.id, name="Pantry", item_type_category_id=groceries.id, amount=Decimal("17.50"), quantity=1),
        ]
    )
    await session.commit()

    parent_budget = await create_budget(
        session,
        user,
        BudgetIn(category_id=food.id, period="monthly", amount=Decimal("100.00"), currency="USD"),
    )
    grocery_budget = await create_budget(
        session,
        user,
        BudgetIn(category_id=groceries.id, period="monthly", amount=Decimal("100.00"), currency="USD"),
    )

    assert parent_budget["spent"] == Decimal("54.50")
    assert grocery_budget["spent"] == Decimal("17.50")
