from __future__ import annotations

from datetime import datetime
from urllib.parse import urlsplit, urlunsplit

from pydantic import BaseModel, Field, field_validator


class SettingsOut(BaseModel):
    base_currency: str
    locale: str
    language: str
    notification_preferences_link: str
    llm_provider: str
    llm_base_url: str | None
    llm_model: str | None
    llm_api_key_configured: bool
    llm_settings_source: str


class SettingsPatch(BaseModel):
    base_currency: str | None = Field(default=None, min_length=3, max_length=3)
    locale: str | None = Field(default=None, min_length=2, max_length=16)
    language: str | None = Field(default=None, min_length=2, max_length=16)
    llm_provider: str | None = None
    llm_base_url: str | None = None
    llm_model: str | None = None
    # Write-only. Omit to preserve the stored key; send "" to clear it.
    llm_api_key: str | None = None

    @field_validator("llm_provider")
    @classmethod
    def validate_provider(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.lower().replace("-", "")
        if normalized not in {"openrouter", "lmstudio"}:
            raise ValueError("provider must be openrouter or lmstudio")
        return normalized

    @field_validator("llm_base_url")
    @classmethod
    def validate_base_url(cls, value: str | None) -> str | None:
        if value is None or value == "":
            return value
        if not value.startswith(("http://", "https://")):
            raise ValueError("URL must start with http:// or https://")
        value = value.rstrip("/")
        # OpenAI-compatible servers (LM Studio, Ollama) expect the version path.
        # A bare host:port pasted from a "server running" banner would hit
        # /chat/completions and get rejected, so default the empty path to /v1.
        parts = urlsplit(value)
        if parts.path in ("", "/"):
            value = urlunsplit((parts.scheme, parts.netloc, "/v1", "", ""))
        return value


class ConsentOut(BaseModel):
    channel: str
    granted: bool
    granted_at: datetime | None
    revoked_at: datetime | None

    model_config = {"from_attributes": True}


class AccountDeleteIn(BaseModel):
    confirmation: str
