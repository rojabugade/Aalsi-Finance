.PHONY: dev up down logs build test gen-types backend-test backend-venv

# Bring up the full stack (postgres+pgvector, redis, minio, api, worker, beat, web).
dev up:
	docker compose up --build

down:
	docker compose down

logs:
	docker compose logs -f

build:
	docker compose build

# Regenerate the shared OpenAPI TypeScript client (API must be running).
gen-types:
	./scripts/gen-types.sh

# Backend unit tests (no Docker needed). Uses uv for the venv + installs.
backend-venv:
	cd backend && uv venv && uv pip install -r requirements.txt

backend-test test:
	cd backend && uv run --no-project pytest -q

# ── Plaid sync ──────────────────────────────────────────────────────────────
# Trigger Plaid sandbox sync (pulls transactions from Plaid sandbox API).
plaid-sync:
	python3 scripts/plaid_sync_trigger.py --env local

plaid-sync-prod:
	python3 scripts/plaid_sync_trigger.py --env prod
