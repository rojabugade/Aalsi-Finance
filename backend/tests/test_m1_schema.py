"""M1 done-condition smoke test.

Inserts one row into every table (in FK order), flushes so server-side
defaults (UUID PKs) populate, asserts each table holds a row, then rolls
back so the dev DB keeps only its seeds. Also checks the pgvector extension
and that the migration's category/merchant seeds loaded.

Skips automatically when no Postgres is reachable, so it never breaks the
DB-less M0 test run. Point it at a DB with `alembic upgrade head` applied via
TEST_DATABASE_URL (defaults to the compose host port 5433).
"""

from __future__ import annotations

import os
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import get_settings
from app.db import Base
from app import models as m

TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://finance:finance@localhost:5433/finance",
)


@pytest.fixture
async def engine():
    eng = create_async_engine(TEST_DATABASE_URL)
    try:
        async with eng.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception as exc:  # noqa: BLE001
        await eng.dispose()
        pytest.skip(f"no Postgres at {TEST_DATABASE_URL}: {exc}")
    yield eng
    await eng.dispose()


async def test_vector_extension_and_seeds(engine):
    async with engine.connect() as conn:
        ext = await conn.scalar(text("SELECT 1 FROM pg_extension WHERE extname='vector'"))
        assert ext == 1, "pgvector extension missing"
        cats = await conn.scalar(select(func.count()).select_from(m.Category))
        merchants = await conn.scalar(select(func.count()).select_from(m.Merchant))
    assert cats >= 17, f"expected seeded taxonomy, got {cats} categories"
    assert merchants >= 10, f"expected seeded merchants, got {merchants}"


async def test_insert_one_row_per_table(engine):
    now = datetime.now(timezone.utc)
    today = date.today()
    sm = async_sessionmaker(engine, expire_on_commit=False)
    async with sm() as s:
        # Roots
        hh = m.Household(name="Test Household", base_currency="USD")
        s.add(hh)
        await s.flush()

        user = m.User(
            household_id=hh.id, email=f"t+{hh.id}@example.com",
            password_hash="x", display_name="Tester",
        )
        s.add(user)
        await s.flush()

        plaid = m.PlaidItem(household_id=hh.id, institution_name="Bank")
        s.add(plaid)
        await s.flush()

        acct = m.AccountLogical(
            household_id=hh.id, owner_user_id=user.id, label="Checking",
            type="checking", currency="USD", plaid_item_id=plaid.id,
        )
        investment_acct = m.AccountLogical(
            household_id=hh.id, owner_user_id=user.id, label="Brokerage",
            type="investment", currency="USD",
        )
        doc = m.Document(
            household_id=hh.id, uploaded_by_user_id=user.id,
            storage_key="household/x/doc.pdf", type="receipt",
            source_channel="upload", status="uploaded",
        )
        cat = m.Category(household_id=hh.id, name="Custom", kind="category")
        s.add_all([acct, investment_acct, doc, cat])
        await s.flush()

        merch = m.Merchant(household_id=hh.id, canonical_name="Local Shop",
                           aliases=["local"], default_category_id=cat.id)
        payment_method = m.PaymentMethod(
            household_id=hh.id, owner_user_id=user.id, account_id=acct.id,
            type="card", name="Everyday card", last4="1234",
        )
        s.add_all([merch, payment_method])
        await s.flush()

        recurring = m.RecurringSeries(
            household_id=hh.id, owner_user_id=user.id, merchant_id=merch.id,
            category_id=cat.id, account_id=acct.id,
            payment_method_id=payment_method.id, name="Monthly shop", amount=12.34,
            currency="USD", cadence="monthly", type="subscription", status="active",
            next_due_date=today,
        )
        holding = m.InvestmentHolding(
            household_id=hh.id, owner_user_id=user.id, account_id=investment_acct.id,
            asset_type="etf", symbol="VT", name="Total World", quantity=1,
            avg_buy_price=100, currency="USD",
        )
        s.add_all([recurring, holding])
        await s.flush()

        s.add(m.HoldingValuation(
            household_id=hh.id, holding_id=holding.id, as_of=today,
            price=110, value=110,
        ))

        txn = m.Transaction(
            household_id=hh.id, account_id=acct.id, owner_user_id=user.id,
            merchant_id=merch.id, payment_method_id=payment_method.id,
            recurring_series_id=recurring.id, amount=12.34, currency="USD",
            base_amount=12.34, fx_rate=1, txn_date=today, category_id=cat.id,
            status="draft", source_document_id=doc.id, source_channel="upload",
            external_id="ext-1",
        )
        s.add(txn)
        await s.flush()

        li = m.LineItem(transaction_id=txn.id, name="Item", amount=12.34,
                        item_type_category_id=cat.id, quantity=1)
        tag = m.Tag(household_id=hh.id, name="biz")
        s.add_all([li, tag])
        await s.flush()

        s.add_all([
            m.TransactionTag(transaction_id=txn.id, tag_id=tag.id),
            m.LineItemTag(line_item_id=li.id, tag_id=tag.id),
            m.RefreshToken(user_id=user.id, token_hash="h",
                           expires_at=now + timedelta(days=1)),
            m.ConsentRecord(user_id=user.id, channel="bot", granted=True, granted_at=now),
            m.AuditLog(household_id=hh.id, actor_user_id=user.id, action="create",
                       entity="transaction", before={}, after={"id": str(txn.id)}),
            m.LLMUsageLog(user_id=user.id, provider="openai", model="gpt",
                          tokens_in=1, tokens_out=2, cost_est=0.001, purpose="test"),
            m.Rule(household_id=hh.id, matcher={"field": "merchant", "op": "eq", "value": "x"},
                   action={"set_category": str(cat.id)}, priority=100, source="user"),
            m.Budget(household_id=hh.id, category_id=cat.id, period="monthly",
                     amount=500, currency="USD"),
            m.FXRate(currency_pair="USD/INR", date=today, rate=83.5),
            m.CrossBorderTransfer(household_id=hh.id, owner_user_id=user.id, direction="out",
                                  from_currency="USD", to_currency="INR", amount=1000,
                                  fx_rate=83.5, purpose="family", transfer_date=today),
            m.GuidanceDoc(country="US", topic="tax", title="401k basics",
                          body="...", source_type="govt", effective_date=today,
                          embedding=[0.0] * get_settings().embed_dim),
            m.Recommendation(household_id=hh.id, user_id=user.id, type="save",
                             payload={"msg": "hi"}, generated_at=now),
            m.Notification(household_id=hh.id, user_id=user.id, type="reminder",
                           channel="inapp", payload={}, scheduled_for=now, status="pending"),
            m.BotLink(user_id=user.id, platform="telegram", platform_user_id="123",
                      token="tok", consent={}, linked_at=now),
            m.IngestionConnection(user_id=user.id, channel="email", provider="gmail",
                                  token_encrypted="tok", status="active"),
        ])
        await s.flush()

        # Debt + income chains
        loan = m.Loan(household_id=hh.id, owner_user_id=user.id, name="Card",
                      type="credit_card", schedule_kind="revolving", principal=1000,
                      currency="USD", interest_rate=19.99, compounding="monthly",
                      min_or_emi_amount=35, due_day=15, start_date=today)
        income = m.IncomeSource(household_id=hh.id, owner_user_id=user.id, employer="Acme",
                                country="US", currency="USD", frequency="biweekly",
                                gross=5000, net=3800)
        s.add_all([loan, income])
        await s.flush()

        s.add(m.CreditCardDetail(
            loan_id=loan.id, credit_limit=5000, statement_balance=1000,
            available_credit=4000, statement_day=5,
        ))

        ps = m.PaymentSchedule(loan_id=loan.id, installment_no=1, due_date=today,
                               principal_component=50, interest_component=15,
                               balance_after=950, status="due")
        paystub = m.Paystub(income_source_id=income.id, source_document_id=doc.id,
                            period_start=today, period_end=today, gross=5000,
                            deductions={"tax": 1200}, net=3800)
        grant = m.EquityGrant(income_source_id=income.id, type="rsu", ticker="ACME",
                              country="US", grant_date=today, shares=100,
                              vesting_schedule={"cliff": 12})
        s.add_all([ps, paystub, grant])
        await s.flush()

        s.add(m.EquityEvent(equity_grant_id=grant.id, type="vest", event_date=today,
                            shares=25, fmv=50, est_tax={"fed": 300}))
        await s.flush()

        # Balances, analyst/memory (M22), loan payments (M27) and guidance plan
        # items (M30) — added after this test was first written.
        thread = m.AnalystThread(household_id=hh.id, key="explain:default")
        s.add(thread)
        await s.flush()

        s.add_all([
            m.AccountBalance(household_id=hh.id, account_id=acct.id, as_of=today,
                             balance=1234.56),
            m.AnalystAlertRow(household_id=hh.id, kind="overspend", severity=5,
                              tone="warning", signature="overspend:groceries",
                              title="Groceries over budget", detail="Over by $50."),
            m.AnalystMessage(thread_id=thread.id, role="user", text="why?"),
            m.MemoryChunk(household_id=hh.id, source_type="transaction",
                          source_id=txn.id, text="Bought groceries",
                          embedding=[0.0] * get_settings().embed_dim),
            m.MemoryFact(household_id=hh.id, domain="finance",
                         text="Prefers avalanche payoff", confidence=0.9,
                         embedding=[0.0] * get_settings().embed_dim),
            m.LoanPayment(loan_id=loan.id, payment_date=today, amount=100,
                          interest_component=15, principal_component=85,
                          balance_after=915),
            m.GuidancePlanItem(household_id=hh.id, user_id=user.id, domain="investment",
                               title="Open a 401k", rationale="Employer match"),
            m.AuthToken(user_id=user.id, purpose="password_reset", token_hash="h",
                        expires_at=now + timedelta(hours=1)),
            m.MfaRecoveryCode(user_id=user.id, code_hash="h"),
        ])
        await s.flush()

        # Every mapped table now has at least the row(s) we added in this txn.
        for table in Base.metadata.sorted_tables:
            count = await s.scalar(select(func.count()).select_from(table))
            assert count >= 1, f"no rows visible in {table.name}"

        await s.rollback()  # leave the dev DB at seed-only state
