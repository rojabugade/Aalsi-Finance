"""M0 smoke tests: the skeleton boots and the meta endpoints answer."""

from fastapi.testclient import TestClient

from app.main import app
from app.version import VERSION

client = TestClient(app)


def test_health_ok():
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_version_shape():
    resp = client.get("/version")
    assert resp.status_code == 200
    body = resp.json()
    assert body["version"] == VERSION
    assert "commit" in body


def test_request_id_echoed():
    resp = client.get("/health", headers={"X-Request-ID": "test-123"})
    assert resp.headers["X-Request-ID"] == "test-123"
