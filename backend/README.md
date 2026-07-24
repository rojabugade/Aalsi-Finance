# Backend

FastAPI (async) + Celery. Module-by-module per `FinanceApp_Build_Spec_v2.md`.

## M0 — Foundation (shipped)

- FastAPI app with structured JSON logging (structlog) + request-ID middleware.
- `/health` → `{"status":"ok"}`, `/version` → `{version, commit}`, OpenAPI at `/docs`.
- Settings via `pydantic-settings` (`app/config.py`), CORS for the web origin.
- Async SQLAlchemy engine + `get_session` dependency + declarative `Base` (`app/db.py`).
- Alembic configured for async autogenerate (`migrations/`) — no models yet (M1).
- Celery app wired to Redis with a `health.ping` task (`app/celery_app.py`).
- Smoke tests (`tests/test_meta.py`): health, version, request-ID echo.

### Run

```bash
uv venv && uv pip install -r requirements.txt   # uv is the project standard (no pip)
uv run --no-project pytest -q                    # tests
uv run --no-project uvicorn app.main:app --reload
```

Or via the root `docker compose up` (api + worker + beat + backing services).

## Deferred (later modules)

- DB schema & migrations → **M1**
- Auth / private workspaces / per-workspace scoping → **M2**
- LLM gateway → **M3**
- Document storage, OCR, transactions, analytics, debt, income, guidance, bot,
  notifications, FX, export → **M4–M16**

## Layout

```
app/
  main.py        FastAPI app, middleware, meta routes
  config.py      Settings (pydantic-settings)
  db.py          Async engine, Base, get_session
  logging.py     structlog JSON config
  celery_app.py  Celery wired to Redis
  version.py     VERSION / COMMIT
migrations/      Alembic (async env)
tests/           pytest smoke tests
```
