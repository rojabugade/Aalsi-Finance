"""Scheduled Plaid sweep.

The important property is isolation: one workspace whose item is revoked or whose
institution is down must not stop every other workspace from syncing.
"""

from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest

from app.tasks import plaid as plaid_task


class _Session:
    """Minimal stand-in returning scripted rows for the two queries the task runs."""

    def __init__(self, results: list):
        self._results = list(results)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return False

    async def execute(self, _stmt):
        value = self._results.pop(0)
        return SimpleNamespace(
            scalars=lambda: SimpleNamespace(
                all=lambda: value if isinstance(value, list) else [value]
            ),
            scalar_one_or_none=lambda: value,
        )


def _sessions(monkeypatch, scripts: list[list]):
    """Hand out one scripted session per `async with SessionLocal()`."""
    queue = list(scripts)

    def _factory():
        return _Session(queue.pop(0))

    monkeypatch.setattr(plaid_task, "SessionLocal", _factory)


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setattr(
        plaid_task,
        "get_settings",
        lambda: SimpleNamespace(plaid_client_id="cid", plaid_secret="secret"),
    )
    monkeypatch.setattr(plaid_task, "PlaidGateway", lambda _settings: object())


@pytest.mark.asyncio
async def test_skips_entirely_when_plaid_is_not_configured(monkeypatch):
    monkeypatch.setattr(
        plaid_task,
        "get_settings",
        lambda: SimpleNamespace(plaid_client_id="", plaid_secret=""),
    )
    result = await plaid_task._sync_all_plaid_items()
    assert result["skipped"] == "unconfigured"
    assert result["synced"] == 0


@pytest.mark.asyncio
async def test_syncs_every_workspace_with_an_active_item(monkeypatch, configured):
    households = [uuid.uuid4(), uuid.uuid4()]
    users = [SimpleNamespace(id=uuid.uuid4()), SimpleNamespace(id=uuid.uuid4())]
    _sessions(monkeypatch, [[households], [users[0]], [users[1]]])

    calls = []

    async def _sync(_session, user, _data, _gateway):
        calls.append(user)
        return {"transactions_created": 3}

    monkeypatch.setattr(plaid_task.service, "plaid_sync", _sync)

    result = await plaid_task._sync_all_plaid_items()
    assert result == {"workspaces": 2, "synced": 2, "failed": 0}
    assert len(calls) == 2


@pytest.mark.asyncio
async def test_one_failing_workspace_does_not_abort_the_sweep(monkeypatch, configured):
    households = [uuid.uuid4(), uuid.uuid4(), uuid.uuid4()]
    users = [SimpleNamespace(id=uuid.uuid4()) for _ in households]
    _sessions(monkeypatch, [[households], [users[0]], [users[1]], [users[2]]])

    seen = []

    async def _sync(_session, user, _data, _gateway):
        seen.append(user)
        if len(seen) == 2:
            raise RuntimeError("ITEM_LOGIN_REQUIRED")
        return {"transactions_created": 1}

    monkeypatch.setattr(plaid_task.service, "plaid_sync", _sync)

    result = await plaid_task._sync_all_plaid_items()
    assert result == {"workspaces": 3, "synced": 2, "failed": 1}
    # The third workspace was still attempted after the second blew up.
    assert len(seen) == 3


@pytest.mark.asyncio
async def test_workspace_without_an_active_user_is_skipped(monkeypatch, configured):
    _sessions(monkeypatch, [[[uuid.uuid4()]], [None]])

    async def _sync(*_args):
        raise AssertionError("must not sync a workspace with no active account")

    monkeypatch.setattr(plaid_task.service, "plaid_sync", _sync)

    result = await plaid_task._sync_all_plaid_items()
    assert result == {"workspaces": 1, "synced": 0, "failed": 0}


def test_sweep_is_registered_on_the_beat_schedule():
    from app.celery_app import celery

    entry = celery.conf.beat_schedule["plaid-sync-all"]
    assert entry["task"] == "plaid.sync_all"
