from __future__ import annotations

import os
import uuid
from datetime import date
from decimal import Decimal

import pytest
import pytest_asyncio
from pydantic import ValidationError
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.guidance.router import cross_border_ask
from app.guidance.schemas import CrossBorderTransferIn, GuidanceAskIn, GuidanceWizardIn
from app.guidance.service import (
    _checklist_domain,
    _source_grounded_answer,
    ask_guidance,
    create_transfer,
    guidance_thread_history,
    limits,
    retrieve_docs,
    wizard,
)
from app.models.conversation import AnalystThread
from app.models.core import Household, User
from app.models.guidance import GuidanceDoc, Notification

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL", "postgresql+asyncpg://finance:finance@localhost:5433/finance")
HOUSEHOLD_PREFIX = "pytest-m10-"


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
        await conn.execute(text("DELETE FROM guidance_doc WHERE title LIKE 'pytest-m10-%'"))
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
    user = User(household_id=hh.id, email=f"{uuid.uuid4().hex}@example.com", password_hash="x")
    session.add(user)
    session.add(GuidanceDoc(country="IN", topic="remittance limits", domain="cross_border", title="pytest-m10-India LRS", body="limit_amount: 250000\nlimit_currency: USD\nlimit_period: financial year\nLRS applies to resident outward remittance.", source_url="https://rbi.example", source_type="govt", effective_date=date(2026, 1, 1)))
    session.add(GuidanceDoc(country="US", topic="investment education", domain="investment", title="pytest-m10-Community investing", body="Community consensus favors diversification and low costs.", source_url="https://community.example", source_type="community", effective_date=date(2026, 1, 1)))
    await session.commit()
    return user


@pytest.mark.asyncio
async def test_guidance_answer_wizard_and_limits(session):
    user = await _user(session)
    answer = await ask_guidance(
        session,
        user,
        GuidanceAskIn(
            question="What should I know about India remittance limits?",
            country="IN",
            domain="cross_border",
        ),
        llm=None,
    )
    assert answer["citations"][0]["source_type"] == "govt"
    assert "not financial" in answer["disclaimer"]

    wiz = await wizard(session, user, GuidanceWizardIn(countries=["IN", "US"], annual_transfer_amount=Decimal("1000"), transfer_currency="USD"))
    assert wiz["checklist"]
    assert (await session.get(Notification, (await session.execute(text("SELECT id FROM notification WHERE household_id=:h LIMIT 1"), {"h": user.household_id})).scalar_one())) is not None

    await create_transfer(session, user, CrossBorderTransferIn(direction="out", from_currency="USD", to_currency="INR", amount=Decimal("210000"), fx_rate=Decimal("83.0"), transfer_date=date.today()))
    out = await limits(session, user)
    assert out == {"totals": [], "limits": [], "warnings": [], "citations": []}


def test_cross_border_transfer_input_rejects_invalid_direction_and_amounts():
    valid = CrossBorderTransferIn(
        direction="out", from_currency="usd", to_currency="inr", amount="1", fx_rate="80"
    )
    assert valid.from_currency == "USD"
    assert valid.to_currency == "INR"

    for payload in (
        {"direction": "outbound", "from_currency": "USD", "to_currency": "INR", "amount": "1"},
        {"direction": "out", "from_currency": "USD", "to_currency": "INR", "amount": "0"},
        {"direction": "out", "from_currency": "US", "to_currency": "INR", "amount": "1"},
        {"direction": "out", "from_currency": "USD", "to_currency": "USD", "amount": "1"},
    ):
        with pytest.raises(ValidationError):
            CrossBorderTransferIn(**payload)


@pytest.mark.asyncio
async def test_retrieval_uses_the_explicit_domain_boundary(session):
    user = await _user(session)
    docs = await retrieve_docs(session, "remittance diversification", domain="cross_border")
    assert [doc.domain for doc in docs] == ["cross_border"]
    assert all(doc.title != "pytest-m10-Community investing" for doc in docs)


class _GuidanceLLM:
    def __init__(self):
        self.chat_calls = []

    async def embed(self, _texts, **_kwargs):
        raise RuntimeError("use deterministic corpus retrieval")

    async def chat(self, messages, **_kwargs):
        self.chat_calls.append(messages)
        return {"content": "The current source describes the remittance limit [1]."}


@pytest.mark.asyncio
async def test_guidance_thread_persists_citations_and_uses_recent_context(session):
    user = await _user(session)
    llm = _GuidanceLLM()
    first = await ask_guidance(
        session,
        user,
        GuidanceAskIn(
            question="What is the India remittance limit?",
            country="IN",
            domain="cross_border",
            thread_id="overview",
        ),
        llm,
    )
    second = await ask_guidance(
        session,
        user,
        GuidanceAskIn(
            question="What should I verify about that remittance limit?",
            country="IN",
            domain="cross_border",
            thread_id="overview",
        ),
        llm,
    )

    assert first["thread_id"] == "overview"
    assert second["thread_id"] == "overview"
    thread = await session.scalar(
        select(AnalystThread).where(
            AnalystThread.household_id == user.household_id,
            AnalystThread.key == f"guidance:{user.id}:overview",
        )
    )
    assert thread is not None
    prompt = llm.chat_calls[-1][-1]["content"]
    assert "Conversation context" in prompt
    assert "What is the India remittance limit?" in prompt
    assert "The current source describes the remittance limit [1]." in prompt
    assert "Current authoritative corpus" in prompt

    history = await guidance_thread_history(session, user, "overview")
    assert [(message.role, message.text) for message in history.messages] == [
        ("user", "What is the India remittance limit?"),
        ("analyst", "The current source describes the remittance limit [1]."),
        ("user", "What should I verify about that remittance limit?"),
        ("analyst", "The current source describes the remittance limit [1]."),
    ]
    assert history.messages[0].citations == []
    assert history.messages[1].citations[0].source_type == "govt"
    assert history.messages[1].disclaimer is not None


@pytest.mark.asyncio
async def test_guidance_threads_are_user_scoped_within_household(session):
    user_a = await _user(session)
    user_b = User(
        household_id=user_a.household_id,
        email=f"{uuid.uuid4().hex}@example.com",
        password_hash="x",
    )
    session.add(user_b)
    await session.commit()

    for user in (user_a, user_b):
        await ask_guidance(
            session,
            user,
            GuidanceAskIn(
                question="What is the India remittance limit?",
                country="IN",
                thread_id="overview",
            ),
            llm=None,
        )

    keys = set(
        (
            await session.execute(
                select(AnalystThread.key).where(AnalystThread.household_id == user_a.household_id)
            )
        ).scalars()
    )
    assert keys == {
        f"guidance:{user_a.id}:overview",
        f"guidance:{user_b.id}:overview",
    }


@pytest.mark.asyncio
async def test_guidance_no_doc_answer_persists_without_llm(session):
    user = await _user(session)
    llm = _GuidanceLLM()
    result = await ask_guidance(
        session,
        user,
        GuidanceAskIn(question="zzzz-no-matching-corpus", thread_id="overview"),
        llm,
    )

    assert result["citations"] == []
    assert result["thread_id"] == "overview"
    assert llm.chat_calls == []
    history = await guidance_thread_history(session, user, "overview")
    assert len(history.messages) == 2
    assert history.messages[-1].citations == []
    assert history.messages[-1].disclaimer == result["disclaimer"]


@pytest.mark.asyncio
async def test_cross_border_alias_forces_domain_and_wizard_can_skip_reminders(session):
    user = await _user(session)
    llm = _GuidanceLLM()
    answer = await cross_border_ask(
        GuidanceAskIn(
            question="What is the India remittance limit?",
            country="IN",
            domain="general",
            thread_id="cross-border",
        ),
        user,
        session,
        llm,
    )
    assert answer["thread_id"] == "cross-border"
    assert "Guidance domain: cross_border" in llm.chat_calls[-1][-1]["content"]

    before = await session.scalar(
        select(func.count()).select_from(Notification).where(Notification.user_id == user.id)
    )
    result = await wizard(
        session,
        user,
        GuidanceWizardIn(countries=["IN"], create_reminders=False),
    )
    after = await session.scalar(
        select(func.count()).select_from(Notification).where(Notification.user_id == user.id)
    )
    assert after == before
    assert result["reminders"] == []
    assert result["checklist"][0]["domain"] == "cross_border"


@pytest.mark.asyncio
async def test_guidance_accepts_documented_maximum_thread_key(session):
    user = await _user(session)
    client_key = "k" * 96

    result = await ask_guidance(
        session,
        user,
        GuidanceAskIn(question="zzzz-no-matching-corpus", thread_id=client_key),
        llm=None,
    )

    assert result["thread_id"] == client_key
    assert len((await guidance_thread_history(session, user, client_key)).messages) == 2


def test_guidance_ask_validates_question_and_thread_lengths():
    with pytest.raises(ValidationError):
        GuidanceAskIn(question="   ")
    with pytest.raises(ValidationError):
        GuidanceAskIn(question="q" * 4001)
    with pytest.raises(ValidationError):
        GuidanceAskIn(question="valid", thread_id="k" * 97)
    with pytest.raises(ValidationError):
        GuidanceAskIn(question="valid", thread_id="not/path-safe")


def test_guidance_fallback_citations_keep_original_document_indices():
    community = GuidanceDoc(
        topic="investment education",
        title="Community first",
        body="Community guidance.",
        source_type="community",
    )
    government = GuidanceDoc(
        topic="remittance limits",
        title="Government second",
        body="Official guidance.",
        source_type="govt",
    )

    answer = _source_grounded_answer("What applies?", [community, government])
    assert "Government/official sources: [2] Government second" in answer


@pytest.mark.parametrize(
    "topic",
    [
        "DTAA foreign tax credit double taxation",
        "FBAR FATCA foreign account reporting limits",
        "tax reporting obligations",
        "remittance limits",
    ],
)
def test_cross_border_corpus_topics_are_classified_for_cross_border_plan(topic):
    assert _checklist_domain(GuidanceDoc(topic=topic)) == "cross_border"
