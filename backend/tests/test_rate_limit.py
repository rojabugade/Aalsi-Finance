"""The login endpoint is rate limited: after the per-window budget is spent, further
attempts from the same client get 429 instead of another credential check. Runs
DB-free (login 401s on a missing user via a stub session) and keys on a unique
forwarded IP so it doesn't collide with other runs sharing the Redis limiter store.

X-Forwarded-For is only trusted for a configured number of proxy hops (a spoofed
header must not mint unlimited buckets), so the fixture sets trusted_proxy_count=1
to make the single forwarded hop authoritative for this test."""

import uuid

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.config import get_settings
from app.db import get_session
from app.main import app
from app.rate_limit import limiter


class _FakeResult:
    def scalar_one_or_none(self):
        return None


class _FakeSession:
    async def execute(self, *a, **k):
        return _FakeResult()

    async def commit(self):
        pass


async def _fake_session():
    yield _FakeSession()


@pytest_asyncio.fixture
async def client():
    was_enabled = limiter.enabled
    settings = get_settings()
    was_trusted = settings.trusted_proxy_count
    limiter.enabled = True
    # Honour the single X-Forwarded-For hop this test uses to isolate its bucket.
    settings.trusted_proxy_count = 1
    app.dependency_overrides[get_session] = _fake_session
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.pop(get_session, None)
    limiter.enabled = was_enabled
    settings.trusted_proxy_count = was_trusted
    limiter.reset()


def _limit_count() -> int:
    # "10/minute" -> 10
    return int(get_settings().rate_limit_login.split("/")[0])


@pytest.mark.asyncio
async def test_login_is_rate_limited(client):
    headers = {"X-Forwarded-For": f"203.0.113.{uuid.uuid4().int % 250}"}
    budget = _limit_count()
    body = {"email": "nobody@example.com", "password": "wrong-password"}

    statuses = [
        (await client.post("/auth/login", json=body, headers=headers)).status_code
        for _ in range(budget + 1)
    ]
    assert statuses[:budget] == [401] * budget  # credential checks, not throttled
    assert statuses[budget] == 429  # budget exhausted -> throttled
