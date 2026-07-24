from __future__ import annotations

import asyncio
import os
import uuid

import pytest
import pytest_asyncio
from fastapi import HTTPException
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
    user = User(household_id=hh.id, email=f"{uuid.uuid4().hex}@example.com", password_hash="x")
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
from app.analyst import service as analyst_service  # noqa: E402
from app.analyst.router import ask as analyst_ask_route  # noqa: E402
from app.analyst.router import thread_history as analyst_thread_history_route  # noqa: E402
from app.analyst.schemas import AnalystAskIn  # noqa: E402
from app.analyst.service import run_ask, run_thread_history  # noqa: E402


@pytest.mark.asyncio
async def test_get_or_create_thread_is_idempotent(session):
    user = await _user(session)
    t1 = await get_or_create_thread(session, user, "dashboard")
    t2 = await get_or_create_thread(session, user, "dashboard")
    assert t1.id == t2.id


@pytest.mark.asyncio
async def test_get_or_create_thread_is_safe_for_concurrent_first_requests(engine, session):
    user = await _user(session)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async with engine.begin() as connection:
        await connection.execute(
            text(
                """
                CREATE OR REPLACE FUNCTION pytest_m22_delay_thread_insert()
                RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                    IF NEW.key = 'guidance:concurrent' THEN
                        PERFORM pg_sleep(0.2);
                    END IF;
                    RETURN NEW;
                END;
                $$
                """
            )
        )
        await connection.execute(
            text(
                """
                CREATE TRIGGER pytest_m22_delay_thread_insert
                BEFORE INSERT ON analyst_thread
                FOR EACH ROW EXECUTE FUNCTION pytest_m22_delay_thread_insert()
                """
            )
        )

    async def create_thread():
        async with session_factory() as concurrent_session:
            return await get_or_create_thread(concurrent_session, user, "guidance:concurrent")

    try:
        results = await asyncio.gather(
            create_thread(),
            create_thread(),
            return_exceptions=True,
        )
        assert not [result for result in results if isinstance(result, BaseException)]
        first, second = results
        assert first.id == second.id
    finally:
        async with engine.begin() as connection:
            await connection.execute(
                text("DROP TRIGGER IF EXISTS pytest_m22_delay_thread_insert ON analyst_thread")
            )
            await connection.execute(
                text("DROP FUNCTION IF EXISTS pytest_m22_delay_thread_insert()")
            )


@pytest.mark.asyncio
async def test_append_and_recent_turns_order_and_limit(session):
    user = await _user(session)
    thread = await get_or_create_thread(session, user, "dashboard")
    await append_turn(session, thread.id, question="q1", answer="a1")
    await append_turn(
        session,
        thread.id,
        question="q2",
        answer="a2",
        analyst_payload={"citations": []},
    )
    await append_turn(session, thread.id, question="q3", answer="a3")
    turns = await recent_turns(session, thread.id, limit=4)
    assert [(m.role, m.text) for m in turns] == [
        ("user", "q2"), ("analyst", "a2"), ("user", "q3"), ("analyst", "a3"),
    ]
    assert [message.payload for message in turns] == [
        None,
        {"citations": []},
        None,
        None,
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


@pytest.mark.asyncio
async def test_analyst_service_rejects_reserved_guidance_thread_namespace(session):
    user_a = await _user(session)
    user_b = User(
        household_id=user_a.household_id,
        email=f"{uuid.uuid4().hex}@example.com",
        password_hash="x",
    )
    session.add(user_b)
    await session.commit()
    key = f"guidance:{user_a.id}:overview"
    thread = await get_or_create_thread(session, user_a, key)
    await append_turn(session, thread.id, question="private question", answer="private answer")

    with pytest.raises(analyst_service.ReservedThreadKey):
        await run_thread_history(session, user_b, key)
    with pytest.raises(analyst_service.ReservedThreadKey):
        await run_ask(
            session,
            user_b,
            AnalystAskIn(mode="explain", question="poison context", thread_id=key),
            _AskLLM(),
        )
    with pytest.raises(HTTPException) as history_error:
        await analyst_thread_history_route(key, user_b, session)
    assert history_error.value.status_code == 404
    with pytest.raises(HTTPException) as ask_error:
        await analyst_ask_route(
            AnalystAskIn(mode="explain", question="poison context", thread_id=key),
            user_b,
            session,
            _AskLLM(),
        )
    assert ask_error.value.status_code == 404

    turns = await recent_turns(session, thread.id, limit=10)
    assert [(turn.role, turn.text) for turn in turns] == [
        ("user", "private question"),
        ("analyst", "private answer"),
    ]
