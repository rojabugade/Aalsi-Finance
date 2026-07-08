"""Provider-agnostic LLM error taxonomy.

Callers (M5/M6/M10) catch these instead of provider-specific exceptions, so the
gateway stays swappable. `map_openai_error` translates the OpenAI SDK's exception
hierarchy (also raised by OpenAI-compatible servers) into this taxonomy and marks
which ones are worth retrying.
"""

from __future__ import annotations


class LLMError(Exception):
    """Base for every gateway failure."""

    retryable: bool = False


class LLMTimeout(LLMError):
    retryable = True


class LLMConnectionError(LLMError):
    retryable = True


class LLMRateLimited(LLMError):
    retryable = True


class LLMServerError(LLMError):
    """Upstream 5xx — transient on the provider side."""

    retryable = True


class LLMBadRequest(LLMError):
    """4xx that won't change on retry (bad auth, malformed request, model missing)."""


class LLMResponseInvalid(LLMError):
    """Response could not be parsed/validated even after one auto-repair attempt."""


class LLMUnsupported(LLMError):
    """Capability the configured provider doesn't offer (e.g. vision on a text model)."""


def map_openai_error(exc: Exception) -> LLMError:
    """Translate an OpenAI SDK exception into the gateway taxonomy.

    Imported lazily so the module loads even if a slim test env lacks the SDK.
    """
    try:
        import openai
    except ModuleNotFoundError:  # pragma: no cover - openai is a hard dep in prod
        return LLMError(str(exc))

    if isinstance(exc, openai.APITimeoutError):
        return LLMTimeout(str(exc))
    if isinstance(exc, openai.APIConnectionError):
        return LLMConnectionError(str(exc))
    if isinstance(exc, openai.RateLimitError):
        return LLMRateLimited(str(exc))
    if isinstance(exc, openai.APIStatusError):
        status = getattr(exc, "status_code", None)
        if status is not None and status >= 500:
            return LLMServerError(f"{status}: {exc}")
        return LLMBadRequest(f"{status}: {exc}")
    if isinstance(exc, openai.APIError):
        # Catch-all for the SDK base (connection-ish); treat as retryable.
        return LLMConnectionError(str(exc))
    return LLMError(str(exc))
