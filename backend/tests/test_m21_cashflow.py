from __future__ import annotations

from decimal import Decimal

from app.cashflow.schemas import CashflowLine, CashflowSummary


def test_cashflow_summary_schema_shape():
    summary = CashflowSummary(
        currency="USD",
        income_monthly=Decimal("5000.00"),
        recurring_monthly=Decimal("900.00"),
        debt_emi_monthly=Decimal("1100.00"),
        card_min_monthly=Decimal("50.00"),
        discretionary_monthly=Decimal("2000.00"),
        leftover_monthly=Decimal("-50.00"),
        breakdown=[CashflowLine(label="Income", amount=Decimal("5000.00"), kind="income")],
    )
    assert summary.leftover_monthly == Decimal("-50.00")
    assert summary.breakdown[0].kind == "income"


def test_monthly_from_cadence_normalizes():
    from app.cashflow.service import monthly_from_cadence

    assert monthly_from_cadence(Decimal("30"), "monthly") == Decimal("30.00")
    assert monthly_from_cadence(Decimal("120"), "annual") == Decimal("10.00")
    assert monthly_from_cadence(Decimal("100"), "irregular") == Decimal("0.00")


def test_monthly_from_frequency_net_to_month():
    from app.cashflow.service import monthly_from_frequency

    # biweekly net 2000 -> 2000*26/12
    assert monthly_from_frequency(Decimal("2000"), "biweekly") == Decimal("4333.33")
    assert monthly_from_frequency(Decimal("6000"), "monthly") == Decimal("6000.00")


import os
import uuid

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.cashflow.service import build_cashflow_summary
from app.income import service as income_service
from app.income.schemas import IncomeSourceIn
from app.models.core import Household, User
from app.models.debt import Loan

TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL", "postgresql+asyncpg://finance:finance@localhost:5433/finance"
)
HH_PREFIX = "pytest-m21-"


@pytest_asyncio.fixture
async def engine():
    eng = create_async_engine(TEST_DATABASE_URL)
    try:
        async with eng.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception as exc:  # noqa: BLE001
        await eng.dispose()
        pytest.skip(f"no Postgres: {exc}")
    yield eng
    async with eng.begin() as conn:
        await conn.execute(text("DELETE FROM household WHERE name LIKE :p"), {"p": f"{HH_PREFIX}%"})
    await eng.dispose()


@pytest_asyncio.fixture
async def session(engine):
    async with async_sessionmaker(engine, expire_on_commit=False)() as s:
        yield s


async def _user(session) -> User:
    hh = Household(name=f"{HH_PREFIX}{uuid.uuid4().hex[:8]}", base_currency="USD")
    session.add(hh)
    await session.flush()
    user = User(
        household_id=hh.id,
        email=f"{uuid.uuid4().hex}@e.com",
        password_hash="x",
    )
    session.add(user)
    await session.flush()
    return user


@pytest.mark.asyncio
async def test_leftover_subtracts_income_recurring_debt(session):
    user = await _user(session)
    await income_service.create_income_source(
        session,
        user,
        IncomeSourceIn(
            employer="Acme",
            country="US",
            currency="USD",
            frequency="monthly",
            gross="6000",
            net="5000",
        ),
    )
    loan = Loan(
        household_id=user.household_id,
        owner_user_id=user.id,
        name="Car",
        type="auto",
        schedule_kind="amortizing",
        principal="10000",
        currency="USD",
        interest_rate="6.0",
        min_or_emi_amount="400",
    )
    session.add(loan)
    await session.flush()

    summary = await build_cashflow_summary(session, user)
    assert summary.income_monthly == Decimal("5000.00")
    assert summary.debt_emi_monthly == Decimal("400.00")
    # No recurring, no cards, no txns -> leftover = 5000 - 400
    assert summary.leftover_monthly == Decimal("4600.00")


@pytest.mark.asyncio
async def test_cashflow_summary_endpoint_via_service(session):
    # Router is a thin wrapper; assert the service returns a valid model
    # the response_model will serialize. Endpoint wiring is smoke-tested
    # by the app import in conftest collection.
    user = await _user(session)
    summary = await build_cashflow_summary(session, user)
    assert summary.currency == "USD"
    assert any(line.kind == "leftover" for line in summary.breakdown)
