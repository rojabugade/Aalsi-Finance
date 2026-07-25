"""M0 smoke tests: the skeleton boots and the meta endpoints answer."""

import pytest
from fastapi.testclient import TestClient

from app import health
from app.main import app
from app.version import VERSION

client = TestClient(app)


def test_health_ok():
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_liveness_does_not_touch_dependencies(monkeypatch):
    """A database outage must not make an otherwise-healthy container look dead."""

    async def _boom() -> None:
        raise RuntimeError("postgres is down")

    monkeypatch.setitem(health._CHECKS, "database", _boom)
    assert client.get("/health").status_code == 200


def test_ready_reports_ok_when_all_checks_pass(monkeypatch):
    async def _ok() -> None:
        return None

    monkeypatch.setattr(health, "_CHECKS", {"database": _ok, "redis": _ok, "storage": _ok})
    resp = client.get("/health/ready")
    assert resp.status_code == 200
    assert resp.json() == {
        "status": "ready",
        "checks": {"database": "ok", "redis": "ok", "storage": "ok"},
    }


def test_ready_is_503_and_names_the_failing_dependency(monkeypatch):
    async def _ok() -> None:
        return None

    async def _boom() -> None:
        raise RuntimeError("connection refused")

    monkeypatch.setattr(health, "_CHECKS", {"database": _ok, "redis": _boom})
    resp = client.get("/health/ready")
    assert resp.status_code == 503
    body = resp.json()
    assert body["status"] == "not_ready"
    assert body["checks"] == {"database": "ok", "redis": "error"}
    assert "connection refused" in body["errors"]["redis"]


@pytest.mark.asyncio
async def test_ready_bounds_a_hung_dependency(monkeypatch):
    """One unresponsive dependency must not hang the probe indefinitely."""
    import asyncio

    async def _hang() -> None:
        await asyncio.sleep(60)

    monkeypatch.setattr(health, "CHECK_TIMEOUT_SECONDS", 0.05)
    name, error = await health._run_check("redis", _hang)
    assert name == "redis"
    assert "timed out" in error


def test_version_shape():
    resp = client.get("/version")
    assert resp.status_code == 200
    body = resp.json()
    assert body["version"] == VERSION
    assert "commit" in body


def test_request_id_echoed():
    resp = client.get("/health", headers={"X-Request-ID": "test-123"})
    assert resp.headers["X-Request-ID"] == "test-123"
