from __future__ import annotations

import io
import os
import uuid
import zipfile
from datetime import date
from decimal import Decimal

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db import get_session
from app.main import app
from app.auth.security import create_access_token
from app.models.accounts import PlaidItem
from app.models.core import AuditLog, ConsentRecord, Household, User
from app.models.debt import Loan
from app.models.income import IncomeSource
from app.models.ingestion import IngestionConnection
from app.models.transactions import LineItem, Transaction

TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://finance:finance@localhost:5433/finance",
)

HOUSEHOLD_PREFIX = "pytest-m16-"


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
async def session_factory(engine):
    return async_sessionmaker(bind=engine, expire_on_commit=False)


@pytest_asyncio.fixture
async def client(session_factory):
    async def _override():
        async with session_factory() as s:
            yield s

    app.dependency_overrides[get_session] = _override
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _signup(session_factory, household_name: str) -> tuple[str, str]:
    email = f"{uuid.uuid4().hex[:12]}@example.com"
    async with session_factory() as s:
        household = Household(name=household_name, base_currency="USD")
        s.add(household)
        await s.flush()
        user = User(
            household_id=household.id,
            email=email,
            password_hash="test-only-not-used",
            display_name="Owner",
            locale="en-US",
            role="owner",
            is_active=True,
        )
        s.add(user)
        await s.commit()
        return create_access_token(user.id, household.id, user.role), email


async def _user_by_email(session_factory, email: str) -> User:
    async with session_factory() as s:
        return (await s.execute(select(User).where(User.email == email))).scalar_one()


@pytest.mark.asyncio
async def test_export_csv_zip_and_pdf(client, session_factory):
    access, email = await _signup(session_factory, f"{HOUSEHOLD_PREFIX}export")
    user = await _user_by_email(session_factory, email)

    async with session_factory() as s:
        txn = Transaction(
            household_id=user.household_id,
            owner_user_id=user.id,
            amount=Decimal("12.34"),
            currency="USD",
            base_amount=Decimal("12.34"),
            txn_date=date(2026, 1, 2),
            status="confirmed",
            is_shared=False,
            notes="coffee",
        )
        loan = Loan(
            household_id=user.household_id,
            owner_user_id=user.id,
            name="Student loan",
            type="education",
            schedule_kind="amortizing",
            principal=Decimal("1000.00"),
            currency="USD",
            start_date=date(2026, 1, 1),
        )
        income = IncomeSource(
            household_id=user.household_id,
            owner_user_id=user.id,
            employer="Acme",
            country="US",
            currency="USD",
            frequency="monthly",
            gross=Decimal("5000.00"),
            net=Decimal("4000.00"),
            withholding={},
        )
        s.add_all([txn, loan, income])
        await s.flush()
        s.add(LineItem(transaction_id=txn.id, name="Latte", amount=Decimal("12.34"), quantity=1))
        await s.commit()

    csv_resp = await client.get("/export?format=csv", headers=_auth(access))
    assert csv_resp.status_code == 200, csv_resp.text
    assert csv_resp.headers["content-type"].startswith("application/zip")
    with zipfile.ZipFile(io.BytesIO(csv_resp.content)) as zf:
        assert {"transactions.csv", "line_items.csv", "loans.csv", "income_sources.csv"} <= set(zf.namelist())
        assert "coffee" in zf.read("transactions.csv").decode()
        assert "Latte" in zf.read("line_items.csv").decode()
        assert "Student loan" in zf.read("loans.csv").decode()
        assert "Acme" in zf.read("income_sources.csv").decode()

    pdf_resp = await client.get("/export?format=pdf", headers=_auth(access))
    assert pdf_resp.status_code == 200, pdf_resp.text
    assert pdf_resp.content.startswith(b"%PDF-1.4")
    assert b"Personal Finance Export Summary" in pdf_resp.content


@pytest.mark.asyncio
async def test_settings_get_and_patch(client, session_factory):
    access, email = await _signup(session_factory, f"{HOUSEHOLD_PREFIX}settings")

    initial = await client.get("/settings", headers=_auth(access))
    assert initial.status_code == 200
    assert initial.json()["base_currency"] == "USD"
    assert initial.json()["notification_preferences_link"] == "/notifications/preferences"
    assert initial.json()["llm_settings_source"] == "environment"

    patched = await client.patch(
        "/settings",
        headers=_auth(access),
        json={"base_currency": "inr", "language": "hi"},
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["base_currency"] == "INR"
    assert patched.json()["locale"] == "hi-IN"

    llm_patched = await client.patch(
        "/settings",
        headers=_auth(access),
        json={
            "llm_provider": "lmstudio",
            "llm_base_url": "http://localhost:1234/v1/",
            "llm_model": "",
            "llm_api_key": "test-secret",
        },
    )
    assert llm_patched.status_code == 200, llm_patched.text
    assert llm_patched.json()["llm_settings_source"] == "app"
    assert llm_patched.json()["llm_base_url"] == "http://localhost:1234/v1"
    assert llm_patched.json()["llm_api_key_configured"] is True
    assert "test-secret" not in llm_patched.text

    async with session_factory() as s:
        user = (await s.execute(select(User).where(User.email == email))).scalar_one()
        audits = (await s.execute(select(AuditLog).where(AuditLog.household_id == user.household_id, AuditLog.action == "settings.update"))).scalars().all()
        assert len(audits) == 2
        assert all("test-secret" not in str(audit.after) for audit in audits)


@pytest.mark.asyncio
async def test_consents_revoke_invalidates_connection_and_audits(client, session_factory):
    access, email = await _signup(session_factory, f"{HOUSEHOLD_PREFIX}consent")
    user = await _user_by_email(session_factory, email)

    async with session_factory() as s:
        s.add(ConsentRecord(user_id=user.id, channel="email", granted=True))
        s.add(IngestionConnection(user_id=user.id, channel="email", provider="gmail", token_encrypted="secret", status="active"))
        s.add(PlaidItem(household_id=user.household_id, access_token_encrypted="plaid-secret", status="active"))
        await s.commit()

    revoke = await client.post("/consents/email/revoke", headers=_auth(access))
    assert revoke.status_code == 200, revoke.text
    assert revoke.json()["channel"] == "email"
    assert revoke.json()["granted"] is False

    consents = await client.get("/consents", headers=_auth(access))
    assert consents.status_code == 200
    assert {row["channel"]: row["granted"] for row in consents.json()}["email"] is False

    async with session_factory() as s:
        conn = (await s.execute(select(IngestionConnection).where(IngestionConnection.user_id == user.id))).scalar_one()
        assert conn.status == "revoked"
        assert conn.token_encrypted is None
        audit = (await s.execute(select(AuditLog).where(AuditLog.household_id == user.household_id, AuditLog.action == "consent.revoke"))).scalar_one()
        assert audit.entity == "email"


@pytest.mark.asyncio
async def test_delete_account_requires_confirmation_and_keeps_audit(client, session_factory):
    access, email = await _signup(session_factory, f"{HOUSEHOLD_PREFIX}delete")
    user = await _user_by_email(session_factory, email)

    bad = await client.request("DELETE", "/account", headers=_auth(access), json={"confirmation": "delete"})
    assert bad.status_code == 400

    async with session_factory() as s:
        txn = Transaction(
            household_id=user.household_id,
            owner_user_id=user.id,
            amount=Decimal("20.00"),
            currency="USD",
            txn_date=date(2026, 1, 1),
            status="confirmed",
            is_shared=False,
        )
        s.add(txn)
        await s.commit()

    deleted = await client.request("DELETE", "/account", headers=_auth(access), json={"confirmation": "DELETE MY ACCOUNT"})
    assert deleted.status_code == 204, deleted.text

    async with session_factory() as s:
        row = await s.get(User, user.id)
        assert row is not None
        assert row.is_active is False
        assert row.email.startswith("deleted+")
        assert (await s.scalar(select(Transaction).where(Transaction.household_id == user.household_id))) is None
        audit = (await s.execute(select(AuditLog).where(AuditLog.household_id == user.household_id, AuditLog.action == "account.delete"))).scalar_one()
        assert audit.before["full_household_delete"] is True
        await s.execute(text("DELETE FROM household WHERE id=:id"), {"id": user.household_id})
        await s.commit()
