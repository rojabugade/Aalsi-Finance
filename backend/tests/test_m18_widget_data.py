from __future__ import annotations

import os
import uuid
from datetime import date
from decimal import Decimal

import pytest
import pytest_asyncio
from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models.accounts import AccountLogical
from app.models.core import Household, User
from app.models.debt import Loan
from app.transactions.schemas import TransactionCreate
from app.transactions.service import NotFound as TransactionNotFound
from app.transactions.service import create_transaction
from app.widget_data import service
from app.widget_data.schemas import (
    CreditCardDetailIn,
    HoldingIn,
    PaymentMethodIn,
    RecurringSeriesIn,
    ValuationIn,
)

TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://finance:finance@localhost:5433/finance",
)
HOUSEHOLD_PREFIX = "pytest-m18-"


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
        await conn.execute(text("DELETE FROM household WHERE name LIKE :prefix"), {"prefix": f"{HOUSEHOLD_PREFIX}%"})
    await eng.dispose()


@pytest_asyncio.fixture
async def session(engine):
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as value:
        yield value


async def _user(session) -> User:
    household = Household(name=f"{HOUSEHOLD_PREFIX}{uuid.uuid4().hex[:8]}", base_currency="USD")
    session.add(household)
    await session.flush()
    user = User(
        household_id=household.id,
        email=f"{uuid.uuid4().hex}@example.com",
        password_hash="x",
    )
    session.add(user)
    await session.flush()
    return user


@pytest.mark.asyncio
async def test_m18_tables_and_transaction_links_exist(engine):
    async with engine.connect() as conn:
        tables = await conn.run_sync(lambda sync: set(inspect(sync).get_table_names()))
        transaction_columns = await conn.run_sync(
            lambda sync: {column["name"] for column in inspect(sync).get_columns("transaction")}
        )
        card_pk = await conn.run_sync(lambda sync: inspect(sync).get_pk_constraint("credit_card_detail"))
    assert {"payment_method", "credit_card_detail", "investment_holding", "holding_valuation", "recurring_series"} <= tables
    assert {"payment_method_id", "recurring_series_id"} <= transaction_columns
    assert card_pk["constrained_columns"] == ["loan_id"]


@pytest.mark.asyncio
async def test_widget_data_round_trip_and_household_scope(session):
    user = await _user(session)
    other = await _user(session)
    account = AccountLogical(
        household_id=user.household_id,
        owner_user_id=user.id,
        label="Brokerage",
        type="investment",
        currency="USD",
    )
    card = Loan(
        household_id=user.household_id,
        owner_user_id=user.id,
        name="Everyday Card",
        type="credit_card",
        schedule_kind="revolving",
        principal=Decimal("250.00"),
        currency="USD",
        interest_rate=Decimal("21.00"),
        min_or_emi_amount=Decimal("25.00"),
        due_day=15,
    )
    session.add_all([account, card])
    await session.flush()

    method = await service.create_payment_method(
        session,
        user,
        PaymentMethodIn(account_id=account.id, type="card", name="Brokerage debit", last4="1234"),
    )
    recurring = await service.create_recurring(
        session,
        user,
        RecurringSeriesIn(
            account_id=account.id,
            payment_method_id=method.id,
            name="Cloud storage",
            amount=Decimal("9.99"),
            currency="usd",
            cadence="monthly",
            type="subscription",
            next_due_date=date(2026, 7, 1),
        ),
    )
    holding = await service.create_holding(
        session,
        user,
        HoldingIn(
            account_id=account.id,
            asset_type="etf",
            symbol="vt",
            name="Total World",
            quantity=Decimal("2.5000"),
            avg_buy_price=Decimal("100.00"),
            currency="usd",
        ),
    )
    valuation = await service.add_valuation(
        session,
        user,
        holding["id"],
        ValuationIn(as_of=date(2026, 6, 19), price=Decimal("120.00")),
    )
    card_out = await service.upsert_credit_card_detail(
        session,
        user,
        card.id,
        CreditCardDetailIn(credit_limit=Decimal("1000.00"), statement_balance=Decimal("250.00"), statement_day=5),
    )
    transaction = await create_transaction(
        session,
        user,
        TransactionCreate(
            account_id=account.id,
            payment_method_id=method.id,
            recurring_series_id=recurring["id"],
            merchant="Cloud storage",
            amount=Decimal("9.99"),
            currency="USD",
            txn_date=date(2026, 6, 19),
        ),
    )

    assert recurring["currency"] == "USD"
    assert holding["symbol"] == "VT"
    assert valuation.value == Decimal("300.00")
    assert card_out["utilization"] == Decimal("25.00")
    assert card_out["available_credit"] == Decimal("750.00")
    assert card_out["detail_complete"] is True
    assert transaction.payment_method_id == method.id
    assert transaction.recurring_series_id == recurring["id"]
    with pytest.raises(TransactionNotFound):
        await create_transaction(
            session,
            other,
            TransactionCreate(
                payment_method_id=method.id,
                amount=Decimal("1.00"),
                currency="USD",
                txn_date=date(2026, 6, 19),
            ),
        )
    assert len(await service.list_payment_methods(session, other)) == 0
    assert len(await service.list_recurring(session, other)) == 0
    assert len(await service.list_holdings(session, other)) == 0
    assert len(await service.list_credit_cards(session, other)) == 0
