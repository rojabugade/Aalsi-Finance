from __future__ import annotations

import os
import uuid
from datetime import date
from decimal import Decimal

import pytest
import pytest_asyncio
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.loans.schemas import LoanIn, LoanPaymentIn, PayoffCalcIn, PayoffStrategyIn
from app.loans.service import (
    create_loan,
    delete_payment,
    list_payments,
    payoff_calc,
    payoff_strategy,
    record_payment,
    schedule,
)
from app.models.core import Household, User
from app.models.debt import Loan, LoanPayment, PaymentSchedule
from app.models.guidance import Notification

TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://finance:finance@localhost:5433/finance",
)

HOUSEHOLD_PREFIX = "pytest-m8-"


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
async def test_emi_schedule_payoff_strategy_and_due_reminder(session):
    user = await _user(session)
    emi = await create_loan(
        session,
        user,
        LoanIn(
            name="India EMI",
            type="education",
            schedule_kind="emi",
            principal=Decimal("1200.00"),
            currency="INR",
            interest_rate=Decimal("12.00"),
            compounding="monthly",
            min_or_emi_amount=Decimal("110.00"),
            due_day=15,
            start_date=date(2026, 1, 15),
            penalty_rules={"late_fee": "500", "warning_days": 999},
        ),
    )

    rows = await schedule(session, user, emi["id"])
    assert rows[0].interest_component == Decimal("12.00")
    assert rows[0].principal_component == Decimal("98.00")
    assert rows[-1].balance_after == Decimal("0.00")
    assert emi["penalty_warning"] is not None
    assert (await session.scalar(select(func.count()).select_from(Notification).where(Notification.type == "loan_due"))) == 1

    calc = await payoff_calc(
        session,
        user,
        emi["id"],
        PayoffCalcIn(monthly_payment=Decimal("200.00"), extra_payments=[]),
    )
    assert calc["months"] < len(rows)
    assert calc["total_interest"] > Decimal("0.00")

    card = await create_loan(
        session,
        user,
        LoanIn(
            name="US Credit Card",
            type="credit_card",
            schedule_kind="revolving",
            principal=Decimal("800.00"),
            currency="USD",
            interest_rate=Decimal("24.00"),
            compounding="monthly",
            min_or_emi_amount=Decimal("40.00"),
            due_day=20,
            start_date=date(2026, 1, 20),
        ),
    )
    avalanche = await payoff_strategy(session, user, PayoffStrategyIn(strategy="avalanche"))
    snowball = await payoff_strategy(session, user, PayoffStrategyIn(strategy="snowball"))
    assert avalanche["ordered_plan"][0]["loan_id"] == card["id"]
    assert snowball["ordered_plan"][0]["loan_id"] == card["id"]


async def _simple_loan(session, user):
    return await create_loan(
        session,
        user,
        LoanIn(
            name="Recompute Loan",
            type="personal",
            schedule_kind="amortizing",
            principal=Decimal("1000.00"),
            currency="USD",
            interest_rate=Decimal("12.00"),  # 1%/month
            compounding="monthly",
            min_or_emi_amount=Decimal("100.00"),
            due_day=1,
            start_date=date(2026, 1, 1),
        ),
    )


@pytest.mark.asyncio
async def test_record_payment_reduces_balance_and_splits(session):
    user = await _user(session)
    loan = await _simple_loan(session, user)
    out = await record_payment(
        session, user, loan["id"], LoanPaymentIn(payment_date=date(2026, 1, 1), amount=Decimal("100.00"))
    )
    # 1% of 1000 = 10 interest, 90 principal, balance 910
    assert out["interest_component"] == Decimal("10.00")
    assert out["principal_component"] == Decimal("90.00")
    assert out["balance_after"] == Decimal("910.00")


@pytest.mark.asyncio
async def test_loan_out_outstanding_and_progress(session):
    user = await _user(session)
    loan = await _simple_loan(session, user)
    await record_payment(
        session, user, loan["id"], LoanPaymentIn(payment_date=date(2026, 1, 1), amount=Decimal("100.00"))
    )
    loans = await __import__("app.loans.service", fromlist=["list_loans"]).list_loans(session, user)
    me = next(l for l in loans if l["id"] == loan["id"])
    assert me["outstanding_balance"] == Decimal("910.00")
    assert me["total_principal_paid"] == Decimal("90.00")
    assert me["total_interest_paid"] == Decimal("10.00")
    assert me["total_paid"] == Decimal("100.00")
    assert 8.5 < me["progress_pct"] < 9.5  # 90/1000 = 9%


@pytest.mark.asyncio
async def test_schedule_recomputes_from_current_balance(session):
    user = await _user(session)
    loan = await _simple_loan(session, user)
    before = await schedule(session, user, loan["id"])
    assert before[0].balance_after == Decimal("910.00")  # first projected installment from full principal
    await record_payment(
        session, user, loan["id"], LoanPaymentIn(payment_date=date(2026, 1, 1), amount=Decimal("100.00"))
    )
    after = await schedule(session, user, loan["id"])
    # first future installment now starts from 910 balance: interest 9.10, principal 90.90 -> 819.10
    assert after[0].balance_after == Decimal("819.10")
    assert after[0].installment_no == 2  # numbered after the one recorded payment


@pytest.mark.asyncio
async def test_delete_payment_restores_projection(session):
    user = await _user(session)
    loan = await _simple_loan(session, user)
    p = await record_payment(
        session, user, loan["id"], LoanPaymentIn(payment_date=date(2026, 1, 1), amount=Decimal("100.00"))
    )
    await delete_payment(session, user, loan["id"], p["id"])
    after = await schedule(session, user, loan["id"])
    assert after[0].balance_after == Decimal("910.00")
    assert after[0].installment_no == 1


@pytest.mark.asyncio
async def test_list_payments_pagination(session):
    user = await _user(session)
    loan = await _simple_loan(session, user)
    for i in range(3):
        await record_payment(
            session, user, loan["id"], LoanPaymentIn(payment_date=date(2026, 1, 1), amount=Decimal("100.00"))
        )
    page = await list_payments(session, user, loan["id"], limit=2, offset=0)
    assert page["total"] == 3
    assert len(page["items"]) == 2


@pytest.mark.asyncio
async def test_payment_household_scoped(session):
    user = await _user(session)
    other = await _user(session)
    loan = await _simple_loan(session, user)
    with pytest.raises(Exception):
        await record_payment(
            session, other, loan["id"], LoanPaymentIn(payment_date=date(2026, 1, 1), amount=Decimal("50.00"))
        )
