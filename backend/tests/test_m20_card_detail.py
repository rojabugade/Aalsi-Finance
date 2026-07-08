from __future__ import annotations

import os
import uuid
from decimal import Decimal

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.loans.service import list_loans
from app.models.core import Household, User
from app.models.debt import CreditCardDetail, Loan

TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://finance:finance@localhost:5433/finance",
)
HOUSEHOLD_PREFIX = "pytest-m20-"


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


@pytest.mark.asyncio
async def test_card_loan_serializes_detail_and_utilization(session):
    user = await _user(session)
    card = Loan(
        household_id=user.household_id, owner_user_id=user.id,
        name="Plaid Credit Card", type="credit_card", schedule_kind="revolving",
        principal=Decimal("500.00"), currency="USD", interest_rate=Decimal("19.99"),
        min_or_emi_amount=Decimal("20.00"), due_day=15, penalty_rules={},
    )
    session.add(card)
    await session.flush()
    session.add(CreditCardDetail(
        loan_id=card.id, credit_limit=Decimal("2000.00"),
        statement_balance=Decimal("480.00"), available_credit=Decimal("1500.00"), statement_day=3,
    ))
    loan_plain = Loan(
        household_id=user.household_id, owner_user_id=user.id,
        name="Auto Loan", type="auto", schedule_kind="amortizing",
        principal=Decimal("10000.00"), currency="USD", penalty_rules={},
    )
    session.add(loan_plain)
    await session.flush()

    out = {o["name"]: o for o in await list_loans(session, user)}
    card_out = out["Plaid Credit Card"]
    assert card_out["credit_card_detail"] is not None
    assert card_out["credit_card_detail"]["credit_limit"] == Decimal("2000.00")
    assert card_out["credit_card_detail"]["statement_balance"] == Decimal("480.00")
    # outstanding_balance == principal (no payments) == 500 -> 500/2000 = 0.25
    assert abs(card_out["credit_card_detail"]["utilization"] - 0.25) < 1e-6
    assert out["Auto Loan"]["credit_card_detail"] is None
