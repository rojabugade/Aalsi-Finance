"""M3 LLM gateway tests.

The OpenAI and Redis clients are injected fakes, so the schema-constrained output,
auto-repair, retry, caching, dim-check and usage-logging paths are all exercised
without a live provider. One Postgres-guarded HTTP test covers POST /admin/llm/ping
end-to-end (auth + usage row written), mirroring the M1/M2 skip style.
"""

from __future__ import annotations

import os
import uuid
from types import SimpleNamespace

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import Settings
from app.llm.client import LLMClient, get_llm_client
from app.llm.errors import LLMResponseInvalid, LLMTimeout, LLMUnsupported
from app.models.core import LLMUsageLog

# --------------------------------------------------------------------------- #
# Fakes
# --------------------------------------------------------------------------- #


class FakeUsage:
    def __init__(self, pin: int = 10, pout: int = 5):
        self.prompt_tokens = pin
        self.completion_tokens = pout
        self.total_tokens = pin + pout


def _chat_response(content=None, tool_calls=None, usage=None):
    msg = SimpleNamespace(content=content, tool_calls=tool_calls)
    return SimpleNamespace(choices=[SimpleNamespace(message=msg)], usage=usage or FakeUsage())


def _embed_response(vectors, usage=None):
    return SimpleNamespace(
        data=[SimpleNamespace(embedding=v) for v in vectors],
        usage=usage or FakeUsage(),
    )


class Scripted:
    """Async `.create` that returns/raises the next scripted item per call."""

    def __init__(self, script):
        self.script = list(script)
        self.calls: list[dict] = []

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        item = self.script.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


class FakeOpenAI:
    def __init__(self, chat_script=None, embed_script=None):
        self.chat = SimpleNamespace(completions=Scripted(chat_script or []))
        self.embeddings = Scripted(embed_script or [])


class FakeRedis:
    def __init__(self):
        self.store: dict[str, str] = {}

    async def get(self, key):
        return self.store.get(key)

    async def set(self, key, value, ex=None):
        self.store[key] = value


class FakeSession:
    """Captures `.add`-ed ORM objects; `flush` is a no-op."""

    def __init__(self):
        self.added: list = []

    def add(self, obj):
        self.added.append(obj)

    async def flush(self):
        return None


class Category(BaseModel):
    category: str
    confidence: float


def _settings(**over) -> Settings:
    base = dict(
        llm_provider="test",
        llm_cache_enabled=False,
        llm_max_retries=3,
        embed_dim=4,
        chat_model="gpt-4o-mini",
        embed_model="text-embedding-3-small",
        llm_supports_structured_output=True,
        llm_supports_vision=True,
    )
    base.update(over)
    return Settings(**base)


def _client(fake, *, redis=None, **over) -> LLMClient:
    return LLMClient(_settings(**over), openai_client=fake, redis_client=redis)


# --------------------------------------------------------------------------- #
# Unit tests
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_plain_chat_returns_content():
    fake = FakeOpenAI(chat_script=[_chat_response(content="hello there")])
    out = await _client(fake).chat([{"role": "user", "content": "hi"}])
    assert out == {"content": "hello there", "tool_calls": None}
    assert len(fake.chat.completions.calls) == 1


@pytest.mark.asyncio
async def test_blank_lmstudio_model_uses_loaded_instance(monkeypatch):
    fake = FakeOpenAI(chat_script=[_chat_response(content="local")])
    client = _client(
        fake,
        llm_provider="lmstudio",
        llm_base_url="http://lmstudio:1234/v1",
        chat_model="",
    )

    async def loaded_model(_requested=None):
        return "loaded-model-id"

    monkeypatch.setattr(client, "_resolve_chat_model", loaded_model)
    out = await client.chat([{"role": "user", "content": "hi"}])

    assert out["content"] == "local"
    assert fake.chat.completions.calls[0]["model"] == "loaded-model-id"


@pytest.mark.asyncio
async def test_blank_model_rejected_for_non_lmstudio_provider():
    client = _client(FakeOpenAI(), llm_provider="openai", chat_model="")
    with pytest.raises(LLMUnsupported, match="CHAT_MODEL is required"):
        await client.chat([{"role": "user", "content": "hi"}])


@pytest.mark.asyncio
async def test_blank_openrouter_model_uses_auto_router():
    fake = FakeOpenAI(chat_script=[_chat_response(content="ok")])
    client = _client(fake, llm_provider="openrouter", chat_model="")
    await client.chat([{"role": "user", "content": "hi"}])
    assert fake.chat.completions.calls[0]["model"] == "openrouter/auto"


@pytest.mark.asyncio
async def test_schema_constrained_valid_first_try():
    fake = FakeOpenAI(
        chat_script=[_chat_response(content='{"category":"groceries","confidence":0.91}')]
    )
    out = await _client(fake).chat(
        [{"role": "user", "content": "classify DMart"}], json_schema=Category
    )
    assert out == {"category": "groceries", "confidence": 0.91}
    # JSON mode requested because supports_structured_output is True.
    assert fake.chat.completions.calls[0]["response_format"] == {"type": "json_object"}


@pytest.mark.asyncio
async def test_schema_auto_repairs_once():
    fake = FakeOpenAI(
        chat_script=[
            _chat_response(content="not json at all"),
            _chat_response(content='{"category":"travel","confidence":0.7}'),
        ]
    )
    out = await _client(fake).chat(
        [{"role": "user", "content": "x"}], json_schema=Category
    )
    assert out["category"] == "travel"
    assert len(fake.chat.completions.calls) == 2  # original + one repair


@pytest.mark.asyncio
async def test_schema_raises_after_repair_exhausted():
    fake = FakeOpenAI(
        chat_script=[_chat_response(content="garbage"), _chat_response(content="still garbage")]
    )
    with pytest.raises(LLMResponseInvalid):
        await _client(fake).chat([{"role": "user", "content": "x"}], json_schema=Category)
    assert len(fake.chat.completions.calls) == 2


@pytest.mark.asyncio
async def test_tolerates_markdown_json_fences():
    fake = FakeOpenAI(
        chat_script=[_chat_response(content='```json\n{"category":"food","confidence":1.0}\n```')]
    )
    out = await _client(fake).chat(
        [{"role": "user", "content": "x"}], json_schema=Category
    )
    assert out["category"] == "food"


@pytest.mark.asyncio
async def test_retries_transient_then_succeeds():
    fake = FakeOpenAI(
        chat_script=[LLMTimeout("transient"), _chat_response(content="recovered")]
    )
    out = await _client(fake).chat([{"role": "user", "content": "x"}])
    assert out["content"] == "recovered"
    assert len(fake.chat.completions.calls) == 2


@pytest.mark.asyncio
async def test_embed_returns_vectors_and_checks_dim():
    fake = FakeOpenAI(embed_script=[_embed_response([[0.1, 0.2, 0.3, 0.4]])])
    vecs = await _client(fake, llm_cache_enabled=False).embed("hello")
    assert vecs == [[0.1, 0.2, 0.3, 0.4]]


@pytest.mark.asyncio
async def test_embed_dim_mismatch_raises():
    fake = FakeOpenAI(embed_script=[_embed_response([[0.1, 0.2, 0.3]])])  # dim 3 != 4
    with pytest.raises(LLMResponseInvalid):
        await _client(fake, llm_cache_enabled=False).embed("hello")


@pytest.mark.asyncio
async def test_embed_cache_hit_skips_second_call():
    fake = FakeOpenAI(embed_script=[_embed_response([[0.1, 0.2, 0.3, 0.4]])])
    redis = FakeRedis()
    client = _client(fake, redis=redis, llm_cache_enabled=True)
    first = await client.embed("same text")
    second = await client.embed("same text")
    assert first == second
    assert len(fake.embeddings.calls) == 1  # second served from cache


@pytest.mark.asyncio
async def test_vision_unsupported_raises():
    fake = FakeOpenAI()
    client = _client(fake, llm_supports_vision=False)
    with pytest.raises(LLMUnsupported):
        await client.vision("describe", image_bytes=b"\x89PNG")


@pytest.mark.asyncio
async def test_usage_logged_to_session():
    fake = FakeOpenAI(chat_script=[_chat_response(content="ok", usage=FakeUsage(100, 20))])
    session = FakeSession()
    await _client(fake).chat(
        [{"role": "user", "content": "hi"}], purpose="categorize", session=session
    )
    assert len(session.added) == 1
    row = session.added[0]
    assert isinstance(row, LLMUsageLog)
    assert row.provider == "test"
    assert row.tokens_in == 100 and row.tokens_out == 20
    assert row.purpose == "categorize"
    assert row.cost_est is not None  # gpt-4o-mini is in the price table


# --------------------------------------------------------------------------- #
# Done-condition HTTP test: POST /admin/llm/ping (needs Postgres)
# --------------------------------------------------------------------------- #

TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://finance:finance@localhost:5433/finance",
)
HOUSEHOLD_PREFIX = "pytest-m3-"


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
        await conn.execute(text("DELETE FROM llm_usage_log WHERE purpose = 'ping'"))
        await conn.execute(
            text("DELETE FROM household WHERE name LIKE :p"),
            {"p": f"{HOUSEHOLD_PREFIX}%"},
        )
    await eng.dispose()


@pytest.mark.asyncio
async def test_admin_ping_logs_usage(engine):
    from app.db import get_session
    from app.main import app

    session_factory = async_sessionmaker(bind=engine, expire_on_commit=False)

    async def _override_session():
        async with session_factory() as s:
            yield s

    fake = FakeOpenAI(chat_script=[_chat_response(content="pong", usage=FakeUsage(3, 1))])
    ping_client = LLMClient(_settings(), openai_client=fake)

    app.dependency_overrides[get_session] = _override_session
    app.dependency_overrides[get_llm_client] = lambda: ping_client
    transport = ASGITransport(app=app)
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            # Sign up an owner to get a bearer token.
            email = f"{uuid.uuid4().hex[:12]}@example.com"
            su = await c.post(
                "/auth/signup",
                json={
                    "email": email,
                    "password": "hunter2pass",
                    "display_name": "Owner",
                    "workspace_name": f"{HOUSEHOLD_PREFIX}ping",
                },
            )
            assert su.status_code == 201, su.text
            token = su.json()["access_token"]

            # Unauthenticated ping is rejected.
            anon = await c.post("/admin/llm/ping")
            assert anon.status_code in (401, 403)

            r = await c.post(
                "/admin/llm/ping", headers={"Authorization": f"Bearer {token}"}
            )
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["ok"] is True and body["reply"] == "pong"
    finally:
        app.dependency_overrides.clear()

    # The ping persisted exactly one usage row.
    async with session_factory() as s:
        from sqlalchemy import select

        rows = (
            await s.execute(select(LLMUsageLog).where(LLMUsageLog.purpose == "ping"))
        ).scalars().all()
        assert len(rows) == 1
        assert rows[0].model == "gpt-4o-mini"
