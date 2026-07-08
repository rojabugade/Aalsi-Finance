"""M3 LLM gateway: provider-agnostic chat / vision / embeddings."""

from app.llm.client import LLMClient, get_llm_client
from app.llm.errors import (
    LLMBadRequest,
    LLMConnectionError,
    LLMError,
    LLMRateLimited,
    LLMResponseInvalid,
    LLMServerError,
    LLMTimeout,
    LLMUnsupported,
)

__all__ = [
    "LLMClient",
    "get_llm_client",
    "LLMError",
    "LLMTimeout",
    "LLMConnectionError",
    "LLMRateLimited",
    "LLMServerError",
    "LLMBadRequest",
    "LLMResponseInvalid",
    "LLMUnsupported",
]
