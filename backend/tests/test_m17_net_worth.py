from __future__ import annotations

import os
import uuid
from datetime import date
from decimal import Decimal

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.analytics.service import net_worth
from app.models.accounts import AccountBalance, AccountLogical
from app.models.core import Household, User
from app.models.debt import Loan
from app.models.fx import FXRate
from app.models.investments import HoldingValuation, InvestmentHolding

TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://finance:finance@localhost:5433/finance",
)

HOUSEHOLD_PREFIX = "pytest-m17-"


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


async def _account(session, user, type_: str, label: str) -> AccountLogical:
    acct = AccountLogical(
        household_id=user.household_id,
        owner_user_id=user.id,
        label=label,
        type=type_,
        currency="USD",
    )
    session.add(acct)
    await session.flush()
    return acct


@pytest.mark.asyncio
async def test_net_worth_assets_minus_liabilities_with_carry_forward(session):
    user = await _user(session)
    checking = await _account(session, user, "checking", "Checking")
    credit = await _account(session, user, "credit", "Card")
    savings = await _account(session, user, "savings", "Savings")
    session.add_all(
        [
            AccountBalance(household_id=user.household_id, account_id=checking.id, as_of=date(2026, 4, 1), balance=Decimal("1000.00")),
            AccountBalance(household_id=user.household_id, account_id=credit.id, as_of=date(2026, 4, 1), balance=Decimal("200.00")),
            AccountBalance(household_id=user.household_id, account_id=checking.id, as_of=date(2026, 5, 1), balance=Decimal("1200.00")),
            AccountBalance(household_id=user.household_id, account_id=savings.id, as_of=date(2026, 5, 1), balance=Decimal("5000.00")),
        ]
    )
    await session.flush()

    result = await net_worth(session, user, date(2026, 4, 1), date(2026, 5, 31))

    # Current: checking 1200 + savings 5000 assets; credit 200 carried forward.
    assert result["assets"] == Decimal("6200.00")
    assert result["liabilities"] == Decimal("200.00")
    assert result["net_worth"] == Decimal("6000.00")
    assert result["currency"] == "USD"

    assert [p["period"] for p in result["points"]] == ["2026-04", "2026-05"]
    april = result["points"][0]
    assert april["assets"] == Decimal("1000.00")  # savings not present yet
    assert april["liabilities"] == Decimal("200.00")
    assert april["net_worth"] == Decimal("800.00")
    assert result["points"][1]["net_worth"] == Decimal("6000.00")


async def _loan(session, user, principal, currency="USD", plaid_account_id=None) -> Loan:
    loan = Loan(
        household_id=user.household_id,
        owner_user_id=user.id,
        name="Loan",
        type="personal",
        schedule_kind="amortizing",
        principal=Decimal(principal),
        currency=currency,
        interest_rate=Decimal("7"),
        min_or_emi_amount=Decimal("100"),
        plaid_account_id=plaid_account_id,
    )
    session.add(loan)
    await session.flush()
    return loan


@pytest.mark.asyncio
async def test_net_worth_converts_foreign_balances_to_base(session):
    user = await _user(session)
    session.add(FXRate(currency_pair="EUR/USD", date=date(2026, 5, 1), rate=Decimal("1.10000000")))
    checking = await _account(session, user, "checking", "USD Checking")
    euro = AccountLogical(
        household_id=user.household_id, owner_user_id=user.id, label="EU", type="savings",
        currency="EUR",
    )
    session.add(euro)
    await session.flush()
    session.add_all([
        AccountBalance(household_id=user.household_id, account_id=checking.id, as_of=date(2026, 5, 1), balance=Decimal("1000.00")),
        AccountBalance(household_id=user.household_id, account_id=euro.id, as_of=date(2026, 5, 1), balance=Decimal("1000.00")),
    ])
    await session.flush()

    result = await net_worth(session, user, date(2026, 5, 1), date(2026, 5, 31))

    # 1000 USD + 1000 EUR * 1.10 = 2100 USD.
    assert result["assets"] == Decimal("2100.00")
    assert result["net_worth"] == Decimal("2100.00")


@pytest.mark.asyncio
async def test_net_worth_includes_manual_loan_liability(session):
    user = await _user(session)
    checking = await _account(session, user, "checking", "Checking")
    session.add(
        AccountBalance(household_id=user.household_id, account_id=checking.id, as_of=date(2026, 5, 1), balance=Decimal("5000.00"))
    )
    await _loan(session, user, "3000")  # manual loan, no plaid link
    await session.flush()

    result = await net_worth(session, user, date(2026, 5, 1), date(2026, 5, 31))

    assert result["assets"] == Decimal("5000.00")
    assert result["liabilities"] == Decimal("3000.00")
    assert result["net_worth"] == Decimal("2000.00")


@pytest.mark.asyncio
async def test_net_worth_dedups_plaid_loan_against_account_balance(session):
    user = await _user(session)
    # A Plaid credit account: has a balance snapshot AND a Loan sharing the plaid id.
    credit = AccountLogical(
        household_id=user.household_id, owner_user_id=user.id, label="Card", type="credit",
        currency="USD", plaid_account_id="plaid-acct-1",
    )
    session.add(credit)
    await session.flush()
    session.add(
        AccountBalance(household_id=user.household_id, account_id=credit.id, as_of=date(2026, 5, 1), balance=Decimal("800.00"))
    )
    await _loan(session, user, "800", plaid_account_id="plaid-acct-1")
    await session.flush()

    result = await net_worth(session, user, date(2026, 5, 1), date(2026, 5, 31))

    # Counted once (via the balance), not doubled by the Loan row.
    assert result["liabilities"] == Decimal("800.00")
    assert result["net_worth"] == Decimal("-800.00")


@pytest.mark.asyncio
async def test_net_worth_adds_holdings_only_without_account_balance(session):
    user = await _user(session)
    # Investment account with no balance snapshot -> holdings supply its value.
    no_bal = await _account(session, user, "investment", "Brokerage A")
    holding = InvestmentHolding(
        household_id=user.household_id, owner_user_id=user.id, account_id=no_bal.id,
        asset_type="stock", name="ACME", quantity=Decimal("10"), currency="USD",
    )
    session.add(holding)
    await session.flush()
    session.add(HoldingValuation(
        household_id=user.household_id, holding_id=holding.id, as_of=date(2026, 5, 1),
        price=Decimal("50.00"), value=Decimal("500.00"),
    ))
    # Investment account WITH a balance snapshot -> holdings ignored (balance wins).
    with_bal = await _account(session, user, "investment", "Brokerage B")
    session.add(
        AccountBalance(household_id=user.household_id, account_id=with_bal.id, as_of=date(2026, 5, 1), balance=Decimal("2000.00"))
    )
    holding_b = InvestmentHolding(
        household_id=user.household_id, owner_user_id=user.id, account_id=with_bal.id,
        asset_type="stock", name="BETA", quantity=Decimal("5"), currency="USD",
    )
    session.add(holding_b)
    await session.flush()
    session.add(HoldingValuation(
        household_id=user.household_id, holding_id=holding_b.id, as_of=date(2026, 5, 1),
        price=Decimal("100.00"), value=Decimal("9999.00"),  # would double-count if used
    ))
    await session.flush()

    result = await net_worth(session, user, date(2026, 5, 1), date(2026, 5, 31))

    # 500 (holdings, no balance) + 2000 (balance, holdings ignored) = 2500.
    assert result["assets"] == Decimal("2500.00")
    assert result["net_worth"] == Decimal("2500.00")


@pytest.mark.asyncio
async def test_net_worth_is_household_scoped(session):
    user_a = await _user(session)
    user_b = await _user(session)
    acct_b = await _account(session, user_b, "checking", "B Checking")
    session.add(
        AccountBalance(household_id=user_b.household_id, account_id=acct_b.id, as_of=date(2026, 5, 1), balance=Decimal("9999.00"))
    )
    await session.flush()

    result = await net_worth(session, user_a, date(2026, 5, 1), date(2026, 5, 31))

    assert result["assets"] == Decimal("0.00")
    assert result["liabilities"] == Decimal("0.00")
    assert result["net_worth"] == Decimal("0.00")
