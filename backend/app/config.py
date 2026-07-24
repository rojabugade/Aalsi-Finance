"""Application settings, loaded from environment / .env via pydantic-settings.

Every service reads the same Settings object. Secrets must come from the environment,
never from code. See .env.example for the full list.
"""

from functools import lru_cache

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Known-insecure defaults that are safe only in local dev. Booting a real
# environment with any of these still set is a hard failure (see Settings validator).
_DEV_JWT_SECRET = "dev-insecure-change-me"
_DEV_STORAGE_KEY = "ZGV2LWluc2VjdXJlLTMyLWJ5dGUta2V5LS0tLS0tLS0="


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    # --- App ---
    app_name: str = "cross-border-finance"
    environment: str = "dev"
    debug: bool = True
    # Public origin the browser loads the web app from (scheme + host, no trailing
    # slash): http://localhost:3000 in dev, https://your-domain in prod. This is the
    # single source of truth for OAuth callbacks and post-auth redirects, so the same
    # config works locally, in the dev compose, and behind a domain — only this changes.
    app_origin: str = "http://localhost:3000"
    # Comma-separated list of allowed CORS origins for the web client. Defaults to
    # app_origin when not set explicitly.
    cors_origins: str = ""

    # --- Database ---
    # async SQLAlchemy URL (asyncpg). Compose overrides host to the `postgres` service.
    database_url: str = "postgresql+asyncpg://finance:finance@localhost:5432/finance"

    # --- Redis / Celery ---
    redis_url: str = "redis://localhost:6379/0"
    celery_broker_url: str = "redis://localhost:6379/1"
    celery_result_backend: str = "redis://localhost:6379/2"

    # --- Object storage (MinIO / S3) ---
    s3_endpoint_url: str = "http://localhost:9000"
    s3_access_key: str = "minioadmin"
    s3_secret_key: str = "minioadmin"
    s3_bucket: str = "documents"
    s3_region: str = "us-east-1"

    # --- Document ingestion & storage (M4) ---
    # Reject uploads above this size (measured on the raw bytes, pre-encryption).
    max_upload_mb: int = 25
    # base64-encoded 32 random bytes. Encrypts stored document bytes at rest
    # (AES-256-GCM). MUST be overridden in any non-dev environment; rotating it
    # makes previously stored documents undecryptable.
    storage_encryption_key: str = "ZGV2LWluc2VjdXJlLTMyLWJ5dGUta2V5LS0tLS0tLS0="
    # TTL for the signed download token returned by GET /documents/{id}/file.
    signed_url_ttl_seconds: int = 300

    # --- OCR & extraction (M5) ---
    # Engine label only; the default engine lazily tries PaddleOCR then Tesseract.
    ocr_engine: str = "paddle"
    ocr_languages: str = "en"
    # Combined (OCR × LLM) confidence below this routes a document to the review
    # queue instead of auto-creating drafts. Never auto-confirm below threshold.
    ocr_confidence_threshold: float = 0.75
    # Cap on scanned-PDF pages we rasterise + OCR. Bounds worst-case latency so a
    # huge scanned dump can't tie up a worker; embedded-text pages are never capped.
    ocr_max_scan_pages: int = 12

    # --- Auth / security (M2) ---
    # MUST be overridden in any non-dev environment. Signs access JWTs.
    jwt_secret: str = "dev-insecure-change-me"
    jwt_algorithm: str = "HS256"
    access_token_ttl_minutes: int = 15
    refresh_token_ttl_days: int = 30
    # TOTP issuer name shown in authenticator apps.
    totp_issuer: str = "AlsiFinance"
    # Refresh tokens live in an httpOnly cookie (never readable by JS) so an XSS in the
    # web app can't exfiltrate them. SameSite=strict + the double-submit CSRF cookie
    # protect the cookie-authenticated /auth/refresh and /auth/logout endpoints.
    # `secure` is derived from app_origin's scheme so it's on for https and off for
    # local http. Name for the CSRF cookie the SPA echoes back in X-CSRF-Token.
    auth_cookie_samesite: str = "strict"
    refresh_cookie_name: str = "cbf_refresh"
    csrf_cookie_name: str = "cbf_csrf"
    csrf_header_name: str = "X-CSRF-Token"

    # --- Rate limiting ---
    # Throttles brute-forceable/abuse-prone endpoints (login, refresh, SMS webhook).
    # Redis-backed so limits hold across API replicas and restarts. Disabled in the
    # test suite (see tests/conftest.py) for determinism.
    rate_limit_enabled: bool = True
    # Number of trusted reverse proxies in front of the app. The rate limiter only
    # honours that many rightmost X-Forwarded-For hops; anything beyond is
    # attacker-controlled and ignored. 0 (the default) means "no trusted proxy" —
    # the limiter keys on the socket peer and ignores X-Forwarded-For entirely, so a
    # spoofed header can't mint unlimited buckets. Set to the real hop count (e.g. 1
    # behind a single nginx/Coolify proxy) in deployments that terminate at a proxy.
    trusted_proxy_count: int = 0
    # Defaults to redis_url when blank; override to isolate the limiter's storage.
    rate_limit_storage_uri: str = ""
    rate_limit_login: str = "10/minute"
    rate_limit_refresh: str = "60/minute"
    rate_limit_sms_webhook: str = "120/minute"

    # --- Embeddings (must match M1 vector(N) dimension) ---
    embed_dim: int = 1536

    # --- LLM gateway (M3) ---
    # Provider-agnostic: point base_url at OpenAI / OpenRouter / LM Studio / Ollama.
    # `llm_provider` is only a label used in usage logs and pricing lookups.
    llm_provider: str = "openai"
    # None => the OpenAI SDK default (https://api.openai.com/v1).
    llm_base_url: str | None = None
    llm_api_key: str = ""
    # Blank enables LM Studio loaded-instance discovery. Hosted providers should
    # configure this explicitly because they do not expose loaded instances.
    chat_model: str = ""
    vision_model: str = ""
    embed_model: str = ""
    # Local servers (LM Studio / Ollama) may lack these — flip off to degrade
    # to prompt-based JSON / skip vision instead of erroring.
    llm_supports_structured_output: bool = True
    llm_supports_vision: bool = True
    llm_timeout_seconds: float = 60.0
    # Our own tenacity retries wrap the SDK; keep the SDK's internal retries at 0.
    llm_max_retries: int = 3
    # Redis response cache for idempotent calls (categorization, embeddings).
    llm_cache_enabled: bool = True
    llm_cache_ttl_seconds: int = 86400

    # --- M10/M11 integrations ---
    corpus_dir: str = "../corpus"
    plaid_client_id: str = ""
    plaid_secret: str = ""
    plaid_environment: str = "Production"
    # Liabilities lets us pull credit-card/student/mortgage balances into the Debt
    # page. Plaid only returns a product if it was requested at link time, so
    # changing this requires re-linking existing items.
    plaid_products: str = "transactions,liabilities"
    # Days of transaction history to request at link time. Plaid's default is 90;
    # 730 (24mo, the max) gives a full history on the first sync. Takes effect on
    # newly linked items only — existing items must be re-linked to backfill.
    plaid_transactions_days_requested: int = 730
    plaid_country_codes: str = "US"
    plaid_redirect_uri: str | None = None
    # Plaid requires each Item to have a webhook URL before sandbox DEFAULT_UPDATE
    # webhooks can be fired. Local sandbox sync does not need the callback to be
    # reachable; it only needs a syntactically valid HTTPS URL on the item.
    plaid_webhook_url: str = ""
    gmail_client_id: str = ""
    gmail_client_secret: str = ""
    # Mailbox-wide OAuth is deliberately disabled pending restricted-scope
    # compliance.  Raw email is never sent to an external LLM unless this
    # explicit, separately reviewed opt-in is enabled.
    email_llm_processing_enabled: bool = False
    # OAuth callbacks default to the web app's /api proxy path under app_origin, which
    # routes to this backend in every stack (dev, compose, Coolify, domain). Override
    # only if you front the API on its own public host. Register the resolved URL as the
    # provider's Callback URL — it must match exactly.
    gmail_redirect_uri: str | None = None
    splitwise_consumer_key: str = ""
    splitwise_secret: str = ""
    splitwise_redirect_uri: str | None = None
    sms_webhook_token_ttl_days: int = 365

    # --- M14 FX ---
    # Frankfurter is a public, no-key ECB-backed FX API.
    fx_api_base_url: str = "https://api.frankfurter.app"

    @model_validator(mode="after")
    def _forbid_default_secrets_in_prod(self) -> "Settings":
        """Refuse to boot a non-dev environment with publicly-known dev secrets.

        The prod compose files inject these via ``${JWT_SECRET:?...}``, but a direct
        ``uvicorn`` launch would otherwise silently run with a secret anyone can read
        from source — allowing full access-token forgery for any user. `dev` and
        `test` keep the convenient defaults; everything else must override them.
        """
        if self.environment.lower() in {"dev", "test"}:
            return self
        insecure = []
        if self.jwt_secret == _DEV_JWT_SECRET:
            insecure.append("jwt_secret")
        if self.storage_encryption_key == _DEV_STORAGE_KEY:
            insecure.append("storage_encryption_key")
        if insecure:
            raise ValueError(
                f"Refusing to start in environment={self.environment!r} with default "
                f"dev secret(s): {', '.join(insecure)}. Set them via the environment."
            )
        return self

    @model_validator(mode="after")
    def _derive_origin_defaults(self) -> "Settings":
        origin = self.app_origin.rstrip("/")
        if not self.cors_origins.strip():
            self.cors_origins = origin
        if not self.splitwise_redirect_uri:
            self.splitwise_redirect_uri = f"{origin}/api/splitwise/oauth/callback"
        if not self.gmail_redirect_uri:
            self.gmail_redirect_uri = f"{origin}/api/email/oauth/callback"
        if not self.plaid_webhook_url:
            if origin.lower().startswith("https://"):
                self.plaid_webhook_url = f"{origin}/webhooks/plaid"
            elif self.plaid_environment.lower() == "sandbox":
                self.plaid_webhook_url = "https://example.com/webhooks/plaid"
        return self

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def auth_cookie_secure(self) -> bool:
        # Secure cookies over https; allow http for local dev so login still works.
        return self.app_origin.lower().startswith("https")


@lru_cache
def get_settings() -> Settings:
    return Settings()
