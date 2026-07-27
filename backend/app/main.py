"""FastAPI application entrypoint (M0).

Provides the runnable skeleton: structured logging, request-ID middleware, CORS for the
web client, and the /health and /version endpoints. Feature routers (M2+) are included
here as they are built.
"""

import uuid

import structlog
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from starlette.middleware.base import BaseHTTPMiddleware

from app.config import get_settings
from app.logging import configure_logging
from app.observability import configure_error_tracking
from app.rate_limit import limiter
from app.version import VERSION

settings = get_settings()
configure_logging(debug=settings.debug)
# Before the app is built, so import-time failures in routers are still captured.
configure_error_tracking()
log = structlog.get_logger()


class RequestIDMiddleware(BaseHTTPMiddleware):
    """Assign each request a request_id, bind it to the log context, echo it back."""

    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(
            request_id=request_id,
            method=request.method,
            path=request.url.path,
        )
        log.info("request.start")
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        log.info("request.end", status_code=response.status_code)
        return response


app = FastAPI(
    title="Cross-Border Personal Finance API",
    version=VERSION,
    description="Document-driven, AI-assisted cross-border personal finance backend.",
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(RequestIDMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# /health (liveness), /health/ready (dependency readiness) and /version.
from app.health import router as health_router  # noqa: E402

app.include_router(health_router)


# Feature routers (mounted as modules land).
from app.auth.workspace_router import router as workspace_router  # noqa: E402
from app.auth.router import router as auth_router  # noqa: E402
from app.analytics.router import router as analytics_router  # noqa: E402
from app.beta.router import router as beta_router  # noqa: E402
from app.analyst.router import router as analyst_router  # noqa: E402
from app.cashflow.router import router as cashflow_router  # noqa: E402
from app.data_controls.router import router as data_controls_router  # noqa: E402
from app.documents.router import router as documents_router  # noqa: E402
from app.fx.router import router as fx_router  # noqa: E402
from app.guidance.router import router as guidance_router  # noqa: E402
from app.income.router import router as income_router  # noqa: E402
from app.ingestion.router import router as ingestion_router  # noqa: E402
from app.loans.router import router as loans_router  # noqa: E402
from app.llm.router import router as llm_router  # noqa: E402
from app.notifications.router import router as notifications_router  # noqa: E402
from app.ocr.router import router as ocr_router  # noqa: E402
from app.transactions.router import router as transactions_router  # noqa: E402
from app.widget_data.router import router as widget_data_router  # noqa: E402

app.include_router(auth_router)
app.include_router(beta_router)
app.include_router(workspace_router)
app.include_router(llm_router)
app.include_router(documents_router)
app.include_router(ocr_router)
app.include_router(fx_router)
app.include_router(transactions_router)
app.include_router(analytics_router)
app.include_router(analyst_router)
app.include_router(cashflow_router)
app.include_router(loans_router)
app.include_router(income_router)
app.include_router(guidance_router)
app.include_router(ingestion_router)
app.include_router(data_controls_router)
app.include_router(notifications_router)
app.include_router(widget_data_router)
