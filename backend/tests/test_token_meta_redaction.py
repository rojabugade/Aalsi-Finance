"""OAuth token metadata persisted to the (unencrypted) connection config must never
carry a secondary secret — Splitwise returns a refresh_token, Gmail a live access
token — only non-secret expiry/scope metadata."""

from __future__ import annotations

from app.ingestion.service import _safe_token_meta


def test_drops_splitwise_refresh_token():
    meta = _safe_token_meta({"access_token": "A", "refresh_token": "R", "token_type": "bearer", "expires_in": 3600})
    assert "refresh_token" not in meta
    assert "access_token" not in meta
    assert meta == {"token_type": "bearer", "expires_in": 3600}


def test_drops_gmail_live_access_token():
    meta = _safe_token_meta({"refresh_token": "R", "token": "LIVE_ACCESS", "expiry": "2026-07-02T00:00:00Z", "scope": "gmail.readonly"})
    assert "token" not in meta
    assert "refresh_token" not in meta
    assert meta == {"expiry": "2026-07-02T00:00:00Z", "scope": "gmail.readonly"}
