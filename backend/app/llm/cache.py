"""Best-effort Redis response cache for idempotent LLM calls.

Keyed on (model, sha256 of the canonical request) so categorization/embedding calls
that repeat — same prompt, same model — skip the provider. Every operation is
swallow-on-failure: a Redis outage must never break an LLM call, only slow it.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any, Protocol


class AsyncCache(Protocol):
    """Minimal async Redis surface (real client or a test fake)."""

    async def get(self, key: str) -> Any: ...
    async def set(self, key: str, value: str, ex: int | None = None) -> Any: ...


def cache_key(model: str, payload: dict[str, Any]) -> str:
    """Stable key from model + a canonical JSON encoding of the request payload."""
    blob = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    digest = hashlib.sha256(blob.encode("utf-8")).hexdigest()
    return f"llm:{model}:{digest}"


class LLMCache:
    def __init__(self, client: AsyncCache | None, *, enabled: bool, ttl_seconds: int):
        self._client = client
        self._enabled = enabled and client is not None
        self._ttl = ttl_seconds

    async def get(self, key: str) -> Any | None:
        if not self._enabled:
            return None
        try:
            raw = await self._client.get(key)  # type: ignore[union-attr]
        except Exception:  # noqa: BLE001 - cache must never be fatal
            return None
        if raw is None:
            return None
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8")
        try:
            return json.loads(raw)
        except (ValueError, TypeError):
            return None

    async def set(self, key: str, value: Any) -> None:
        if not self._enabled:
            return
        try:
            await self._client.set(  # type: ignore[union-attr]
                key, json.dumps(value, default=str), ex=self._ttl
            )
        except Exception:  # noqa: BLE001 - cache must never be fatal
            return
