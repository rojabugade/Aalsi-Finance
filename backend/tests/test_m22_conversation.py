from __future__ import annotations

import os
import uuid

import pytest
import pytest_asyncio
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models.conversation import AnalystMessage, AnalystThread
from app.models.core import Household, User

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL", "postgresql+asyncpg://finance:finance@localhost:5433/finance")
PREFIX = "pytest-m22cv-"


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
        await conn.execute(text("DELETE FROM household WHERE name LIKE :p"), {"p": f"{PREFIX}%"})
    await eng.dispose()


@pytest_asyncio.fixture
async def session(engine):
    async with async_sessionmaker(engine, expire_on_commit=False)() as s:
        yield s


async def _user(session):
    hh = Household(name=f"{PREFIX}{uuid.uuid4().hex[:8]}", base_currency="USD")
    session.add(hh)
    await session.flush()
    user = User(household_id=hh.id, email=f"{uuid.uuid4().hex}@example.com", password_hash="x", role="owner")
    session.add(user)
    await session.commit()
    return user


@pytest.mark.asyncio
async def test_thread_and_message_round_trip(session):
    user = await _user(session)
    thread = AnalystThread(household_id=user.household_id, key="dashboard")
    session.add(thread)
    await session.flush()
    session.add(AnalystMessage(thread_id=thread.id, role="user", text="how am I doing?"))
    session.add(AnalystMessage(thread_id=thread.id, role="analyst", text="Your spending looks steady."))
    await session.commit()
    msgs = (await session.execute(
        select(AnalystMessage).where(AnalystMessage.thread_id == thread.id)
        .order_by(AnalystMessage.created_at.asc())
    )).scalars().all()
    assert [m.role for m in msgs] == ["user", "analyst"]
    assert msgs[0].text == "how am I doing?"


from app.analyst.conversation import append_turn, get_or_create_thread, recent_turns  # noqa: E402
from app.analyst.schemas import AnalystAskIn  # noqa: E402
from app.analyst.service import run_ask, run_thread_history  # noqa: E402


@pytest.mark.asyncio
async def test_get_or_create_thread_is_idempotent(session):
    user = await _user(session)
    t1 = await get_or_create_thread(session, user, "dashboard")
    t2 = await get_or_create_thread(session, user, "dashboard")
    assert t1.id == t2.id


@pytest.mark.asyncio
async def test_append_and_recent_turns_order_and_limit(session):
    user = await _user(session)
    thread = await get_or_create_thread(session, user, "dashboard")
    await append_turn(session, thread.id, question="q1", answer="a1")
    await append_turn(session, thread.id, question="q2", answer="a2")
    await append_turn(session, thread.id, question="q3", answer="a3")
    turns = await recent_turns(session, thread.id, limit=4)
    assert [(m.role, m.text) for m in turns] == [
        ("user", "q2"), ("analyst", "a2"), ("user", "q3"), ("analyst", "a3"),
    ]


class _AskLLM:
    def __init__(self):
        from app.config import get_settings
        self.dim = get_settings().embed_dim

    async def embed(self, texts, **kw):
        items = [texts] if isinstance(texts, str) else list(texts)
        return [[float(len(t) % 7)] + [0.0] * (self.dim - 1) for t in items]

    async def chat(self, messages, **kw):
        return {"content": "Your spending looks steady."}


@pytest.mark.asyncio
async def test_run_ask_persists_and_returns_thread(session):
    user = await _user(session)
    data = AnalystAskIn(mode="explain", question="how am I doing?", thread_id="dashboard")
    out = await run_ask(session, user, data, _AskLLM())
    assert out.thread_id == "dashboard"
    thread = await get_or_create_thread(session, user, "dashboard")
    turns = await recent_turns(session, thread.id)
    assert [(m.role, m.text) for m in turns] == [
        ("user", "how am I doing?"), ("analyst", "Your spending looks steady."),
    ]


@pytest.mark.asyncio
async def test_run_ask_without_thread_id_persists_nothing(session):
    user = await _user(session)
    data = AnalystAskIn(mode="explain", question="how am I doing?")
    out = await run_ask(session, user, data, _AskLLM())
    assert out.thread_id is None


@pytest.mark.asyncio
async def test_run_thread_history_returns_chronological_messages(session):
    user = await _user(session)
    data = AnalystAskIn(mode="explain", question="hello there", thread_id="dashboard")
    await run_ask(session, user, data, _AskLLM())
    out = await run_thread_history(session, user, "dashboard")
    assert [(m.role, m.text) for m in out.messages] == [
        ("user", "hello there"), ("analyst", "Your spending looks steady."),
    ]


@pytest.mark.asyncio
async def test_run_thread_history_empty_for_unknown_key(session):
    user = await _user(session)
    out = await run_thread_history(session, user, "never-used")
    assert out.messages == []
