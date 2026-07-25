"""Provider-agnostic LLM gateway (M3).

One `LLMClient` wraps the OpenAI SDK against any OpenAI-compatible `base_url`
(OpenAI / OpenRouter / LM Studio / Ollama). It offers chat, vision and embeddings
with schema-constrained JSON output (validate-then-repair-once), tenacity retries,
a best-effort Redis cache, and per-call usage logging to `llm_usage_log`.

The OpenAI and Redis clients are injectable so the whole path is unit-testable
without a live endpoint. Callers depend only on `app.llm.errors`, never on the SDK.
"""

from __future__ import annotations

import base64
import json
import time
import uuid
from functools import lru_cache
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import httpx
import structlog
from fastapi import Depends
from pydantic import BaseModel, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession
from tenacity import (
    AsyncRetrying,
    retry_if_exception,
    stop_after_attempt,
    wait_random_exponential,
)

from app.auth.deps import get_current_user
from app.config import Settings, get_settings
from app.db import get_session
from app.ingestion.crypto import decrypt_string
from app.llm.cache import LLMCache, cache_key
from app.llm.errors import (
    LLMConnectionError,
    LLMError,
    LLMResponseInvalid,
    LLMUnsupported,
    map_openai_error,
)
from app.llm.pricing import estimate_cost
from app.llm.quota import check_quota
from app.models.core import Household, LLMUsageLog, User

log = structlog.get_logger()

# A redaction hook trims/masks text before it leaves the process.
RedactionHook = "callable[[str], str]"


def _is_retryable(exc: BaseException) -> bool:
    return isinstance(exc, LLMError) and exc.retryable


def _extract_json(content: str) -> Any:
    """Parse a JSON object out of a model reply, tolerating ```json fences."""
    text = content.strip()
    if text.startswith("```"):
        text = text.strip("`")
        # Drop an optional leading language tag (e.g. "json\n{...}").
        newline = text.find("\n")
        if newline != -1 and text[:newline].strip().lower() in {"json", ""}:
            text = text[newline + 1 :]
    return json.loads(text)


def _schema_instruction(model_cls: type[BaseModel]) -> str:
    schema = json.dumps(model_cls.model_json_schema(), separators=(",", ":"))
    return (
        "Respond with a SINGLE JSON object that validates against this JSON Schema. "
        "Output only the JSON — no markdown fences, no prose.\n\nJSON Schema:\n"
        + schema
    )


class LLMClient:
    def __init__(
        self,
        settings: Settings | None = None,
        *,
        openai_client: Any | None = None,
        redis_client: Any | None = None,
        redaction_hook: Any | None = None,
    ):
        self.settings = settings or get_settings()
        self._client = openai_client or self._build_openai_client()
        self._loaded_chat_model: str | None = None
        self._redact = redaction_hook
        if redis_client is None and self.settings.llm_cache_enabled:
            redis_client = self._build_redis_client()
        self.cache = LLMCache(
            redis_client,
            enabled=self.settings.llm_cache_enabled,
            ttl_seconds=self.settings.llm_cache_ttl_seconds,
        )

    # --- construction helpers -------------------------------------------------

    def _build_openai_client(self) -> Any:
        from openai import AsyncOpenAI

        return AsyncOpenAI(
            base_url=self.settings.llm_base_url,
            api_key=self.settings.llm_api_key or "not-needed",
            timeout=self.settings.llm_timeout_seconds,
            max_retries=0,  # we own retries via tenacity
        )

    def _build_redis_client(self) -> Any | None:
        try:
            from redis.asyncio import from_url

            return from_url(self.settings.redis_url)
        except Exception:  # noqa: BLE001 - cache is optional
            return None

    def _redact_text(self, text: str) -> str:
        if self._redact and isinstance(text, str):
            return self._redact(text)
        return text

    # --- retry / request core -------------------------------------------------

    async def _retry(self, fn) -> Any:
        async def _mapped() -> Any:
            try:
                return await fn()
            except LLMError:
                raise
            except Exception as exc:  # noqa: BLE001 - mapped to taxonomy
                raise map_openai_error(exc) from exc

        retrying = AsyncRetrying(
            reraise=True,
            stop=stop_after_attempt(max(1, self.settings.llm_max_retries)),
            wait=wait_random_exponential(multiplier=0.5, max=8),
            retry=retry_if_exception(_is_retryable),
        )
        return await retrying(_mapped)

    async def _create_chat(self, **kwargs) -> Any:
        return await self._retry(
            lambda: self._client.chat.completions.create(**kwargs)
        )

    @staticmethod
    def _first_message(resp: Any) -> Any:
        """Return the first choice's message, or raise a clear error.

        OpenAI-compatible servers behind a wrong base_url (e.g. LM Studio hit
        without the /v1 path) return a 200 whose body has no `choices`, so a
        raw `resp.choices[0]` blows up with an opaque TypeError. Surface the
        real cause instead.
        """
        choices = getattr(resp, "choices", None)
        if not choices:
            raise LLMResponseInvalid(
                "provider returned no choices — check the LLM base URL is an "
                "OpenAI-compatible endpoint (LM Studio/Ollama usually need /v1)"
            )
        return choices[0].message

    async def _resolve_chat_model(self, requested: str | None = None) -> str:
        """Return an explicit model, or LM Studio's sole loaded LLM instance."""
        configured = (requested or self.settings.chat_model or "").strip()
        if configured:
            return configured
        if self._loaded_chat_model:
            return self._loaded_chat_model
        if self.settings.llm_provider.lower() == "openrouter":
            return "openrouter/auto"
        if self.settings.llm_provider.lower() not in {"lmstudio", "lm-studio"}:
            raise LLMUnsupported("CHAT_MODEL is required for this LLM provider")
        if not self.settings.llm_base_url:
            raise LLMUnsupported("LLM_BASE_URL is required for LM Studio model discovery")

        parts = urlsplit(self.settings.llm_base_url)
        models_url = urlunsplit((parts.scheme, parts.netloc, "/api/v1/models", "", ""))
        try:
            async with httpx.AsyncClient(timeout=self.settings.llm_timeout_seconds) as client:
                response = await client.get(models_url)
                response.raise_for_status()
                models = response.json().get("models", [])
        except Exception as exc:  # noqa: BLE001 - normalize discovery failures
            raise LLMConnectionError(f"LM Studio model discovery failed: {exc}") from exc

        loaded = [
            instance.get("id")
            for model in models
            if model.get("type") == "llm"
            for instance in model.get("loaded_instances", [])
            if instance.get("id")
        ]
        if len(loaded) != 1:
            detail = "none" if not loaded else ", ".join(loaded)
            raise LLMUnsupported(
                f"Expected exactly one loaded LM Studio LLM, found {detail}. "
                "Load one model or set CHAT_MODEL explicitly."
            )
        self._loaded_chat_model = loaded[0]
        return self._loaded_chat_model

    # --- usage logging --------------------------------------------------------

    async def _log_usage(
        self,
        *,
        session: AsyncSession | None,
        model: str,
        usage: Any,
        purpose: str | None,
        user_id: uuid.UUID | None,
    ) -> None:
        tokens_in = getattr(usage, "prompt_tokens", None) if usage else None
        tokens_out = getattr(usage, "completion_tokens", None) if usage else None
        cost = estimate_cost(model, tokens_in, tokens_out)
        log.info(
            "llm.usage",
            provider=self.settings.llm_provider,
            model=model,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            cost_est=str(cost) if cost is not None else None,
            purpose=purpose,
        )
        if session is None:
            return
        session.add(
            LLMUsageLog(
                user_id=user_id,
                provider=self.settings.llm_provider,
                model=model,
                tokens_in=tokens_in,
                tokens_out=tokens_out,
                cost_est=cost,
                purpose=purpose,
            )
        )
        await session.flush()

    # --- public API -----------------------------------------------------------

    async def chat(
        self,
        messages: list[dict[str, Any]],
        *,
        json_schema: type[BaseModel] | None = None,
        tools: list[dict[str, Any]] | None = None,
        model: str | None = None,
        temperature: float = 0.0,
        max_tokens: int | None = None,
        purpose: str | None = None,
        user_id: uuid.UUID | None = None,
        session: AsyncSession | None = None,
        use_cache: bool = False,
    ) -> dict[str, Any]:
        """Chat completion.

        With `json_schema` (a Pydantic model) the reply is parsed, validated, and
        on failure re-requested once with the validation error before raising. The
        return is always a dict: validated data when `json_schema` is set, otherwise
        ``{"content": str, "tool_calls": list | None}``.
        """
        model = await self._resolve_chat_model(model)
        messages = [
            {**m, "content": self._redact_text(m["content"])}
            if isinstance(m.get("content"), str)
            else m
            for m in messages
        ]

        cache_payload = {
            "messages": messages,
            "tools": tools,
            "temperature": temperature,
            "schema": json_schema.__name__ if json_schema else None,
        }
        key = cache_key(model, cache_payload) if use_cache else None
        if key:
            cached = await self.cache.get(key)
            if cached is not None:
                return cached

        result = await self._complete(
            messages,
            model=model,
            json_schema=json_schema,
            tools=tools,
            temperature=temperature,
            max_tokens=max_tokens,
            purpose=purpose,
            user_id=user_id,
            session=session,
        )
        if key:
            await self.cache.set(key, result)
        return result

    async def vision(
        self,
        prompt: str,
        *,
        image_bytes: bytes | None = None,
        image_url: str | None = None,
        mime_type: str = "image/png",
        json_schema: type[BaseModel] | None = None,
        model: str | None = None,
        temperature: float = 0.0,
        max_tokens: int | None = None,
        purpose: str | None = None,
        user_id: uuid.UUID | None = None,
        session: AsyncSession | None = None,
    ) -> dict[str, Any]:
        """Vision completion over an image (raw bytes or URL)."""
        if not self.settings.llm_supports_vision:
            raise LLMUnsupported("vision disabled for the configured provider")
        if not image_bytes and not image_url:
            raise ValueError("vision requires image_bytes or image_url")

        if image_url:
            url = image_url
        else:
            b64 = base64.b64encode(image_bytes).decode("ascii")
            url = f"data:{mime_type};base64,{b64}"

        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": self._redact_text(prompt)},
                    {"type": "image_url", "image_url": {"url": url}},
                ],
            }
        ]
        return await self._complete(
            messages,
            model=model or self.settings.vision_model,
            json_schema=json_schema,
            tools=None,
            temperature=temperature,
            max_tokens=max_tokens,
            purpose=purpose,
            user_id=user_id,
            session=session,
        )

    async def embed(
        self,
        texts: str | list[str],
        *,
        model: str | None = None,
        purpose: str | None = "embed",
        user_id: uuid.UUID | None = None,
        session: AsyncSession | None = None,
        use_cache: bool = True,
    ) -> list[list[float]]:
        """Embed one or more texts; returns one vector per input, in order.

        Each vector's dimension is asserted to equal `settings.embed_dim` so it
        always fits M1's `vector(N)` columns. Hits the cache per-text.
        """
        model = model or self.settings.embed_model
        single = isinstance(texts, str)
        items = [texts] if single else list(texts)
        items = [self._redact_text(t) for t in items]

        results: list[list[float] | None] = [None] * len(items)
        misses: list[int] = []
        keys: list[str | None] = [None] * len(items)
        for i, text in enumerate(items):
            if use_cache:
                keys[i] = cache_key(model, {"embed": text})
                cached = await self.cache.get(keys[i])
                if cached is not None:
                    results[i] = cached
                    continue
            misses.append(i)

        if misses:
            resp = await self._retry(
                lambda: self._client.embeddings.create(
                    model=model, input=[items[i] for i in misses]
                )
            )
            for slot, i in enumerate(misses):
                vec = list(resp.data[slot].embedding)
                if len(vec) != self.settings.embed_dim:
                    raise LLMResponseInvalid(
                        f"embedding dim {len(vec)} != configured embed_dim "
                        f"{self.settings.embed_dim} (model {model})"
                    )
                results[i] = vec
                if use_cache and keys[i]:
                    await self.cache.set(keys[i], vec)
            await self._log_usage(
                session=session,
                model=model,
                usage=getattr(resp, "usage", None),
                purpose=purpose,
                user_id=user_id,
            )

        return results  # type: ignore[return-value]

    async def ping(self, *, session: AsyncSession | None = None) -> dict[str, Any]:
        """Diagnostic round-trip used by POST /admin/llm/ping."""
        started = time.perf_counter()
        model = await self._resolve_chat_model()
        out = await self.chat(
            [{"role": "user", "content": "Reply with the single word: pong"}],
            max_tokens=8,
            purpose="ping",
            session=session,
        )
        return {
            "ok": True,
            "provider": self.settings.llm_provider,
            "model": model,
            "latency_ms": round((time.perf_counter() - started) * 1000, 1),
            "reply": out.get("content"),
        }

    # --- internals ------------------------------------------------------------

    async def _complete(
        self,
        messages: list[dict[str, Any]],
        *,
        model: str,
        json_schema: type[BaseModel] | None,
        tools: list[dict[str, Any]] | None,
        temperature: float,
        max_tokens: int | None,
        purpose: str | None,
        user_id: uuid.UUID | None,
        session: AsyncSession | None,
    ) -> dict[str, Any]:
        # Checked here rather than in each public entrypoint so chat and vision are
        # both covered, and before any request is billed.
        await check_quota(session, user_id)
        kwargs: dict[str, Any] = {
            "model": model,
            "temperature": temperature,
        }
        if max_tokens is not None:
            kwargs["max_tokens"] = max_tokens
        if tools:
            kwargs["tools"] = tools

        if json_schema is None:
            kwargs["messages"] = messages
            resp = await self._create_chat(**kwargs)
            await self._log_usage(
                session=session,
                model=model,
                usage=getattr(resp, "usage", None),
                purpose=purpose,
                user_id=user_id,
            )
            choice = self._first_message(resp)
            return {
                "content": getattr(choice, "content", None),
                "tool_calls": getattr(choice, "tool_calls", None),
            }

        # Schema-constrained path: instruct, optionally use JSON mode, validate, repair once.
        schema_messages = messages + [
            {"role": "system", "content": _schema_instruction(json_schema)}
        ]
        if self.settings.llm_supports_structured_output:
            kwargs["response_format"] = {"type": "json_object"}

        resp = await self._create_chat(messages=schema_messages, **kwargs)
        await self._log_usage(
            session=session,
            model=model,
            usage=getattr(resp, "usage", None),
            purpose=purpose,
            user_id=user_id,
        )
        raw = self._first_message(resp).content or ""
        try:
            return json_schema.model_validate(_extract_json(raw)).model_dump(mode="json")
        except (ValidationError, ValueError) as first_err:
            repair_messages = schema_messages + [
                {"role": "assistant", "content": raw},
                {
                    "role": "user",
                    "content": (
                        "That response was not valid. Error:\n"
                        f"{first_err}\n"
                        "Return a corrected JSON object only."
                    ),
                },
            ]
            resp2 = await self._create_chat(messages=repair_messages, **kwargs)
            await self._log_usage(
                session=session,
                model=model,
                usage=getattr(resp2, "usage", None),
                purpose=f"{purpose or 'chat'}:repair",
                user_id=user_id,
            )
            raw2 = self._first_message(resp2).content or ""
            try:
                return json_schema.model_validate(_extract_json(raw2)).model_dump(
                    mode="json"
                )
            except (ValidationError, ValueError) as second_err:
                raise LLMResponseInvalid(
                    f"schema validation failed after one repair: {second_err}"
                ) from second_err


@lru_cache
def get_default_llm_client() -> LLMClient:
    """Process-wide client backed by environment settings."""
    return LLMClient()


async def get_llm_client(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> LLMClient:
    """Build a request client from the household override, falling back to .env."""
    return await get_household_llm_client(session, user.household_id)


async def get_household_llm_client(
    session: AsyncSession, household_id: uuid.UUID
) -> LLMClient:
    """Resolve the effective LLM client for requests and background work."""
    household = await session.get(Household, household_id)
    config = household.llm_config if household else None
    if not config:
        return get_default_llm_client()
    settings = get_settings().model_copy(
        update={
            "llm_provider": config.get("provider", ""),
            "llm_base_url": config.get("base_url"),
            "llm_api_key": decrypt_string(config.get("api_key_encrypted")) or "",
            "chat_model": config.get("model", ""),
        }
    )
    return LLMClient(settings)
