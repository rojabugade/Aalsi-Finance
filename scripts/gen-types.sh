#!/usr/bin/env bash
# Pull the live OpenAPI schema from the running API and regenerate the shared
# TypeScript client into /shared. Requires the API to be up (docker compose up) and
# npx available. The OpenAPI schema is the contract between backend and web.
set -euo pipefail

API_URL="${API_URL:-http://localhost:8000}"
OUT_DIR="$(cd "$(dirname "$0")/.." && pwd)/shared"
SCHEMA="${OUT_DIR}/openapi.json"

mkdir -p "${OUT_DIR}"

echo "Fetching OpenAPI schema from ${API_URL}/openapi.json ..."
curl -fsS "${API_URL}/openapi.json" -o "${SCHEMA}"

echo "Generating TypeScript types -> ${OUT_DIR}/api-types.ts"
npx --yes openapi-typescript "${SCHEMA}" -o "${OUT_DIR}/api-types.ts"

echo "Done. Import generated types from '@shared/api-types'."
