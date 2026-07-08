## Target
`backend/app/ingestion/gateways.py` Plaid sandbox webhook setup and `PlaidGateway.sandbox_fire_default_update`.

## Dependents (42 references across 8 Python files)
- `backend/app/ingestion/service.py`: calls `sandbox_fire_default_update()` before `transactions/sync`.
- `backend/app/ingestion/router.py`: exposes `/plaid/sync` and `/plaid/link-token` through the service/gateway path.
- `scripts/plaid_sync_trigger.py`: cron entry point calling `/plaid/sync`.
- `backend/tests/test_ingestion_gateways.py`: gateway unit coverage.
- `backend/tests/test_m11_ingestion.py`: Plaid ingestion integration coverage.
- `backend/tests/test_plaid_sync_incremental.py`: incremental sync coverage.

## Affected Stories
- No `specs/release-plan.yaml` or epic capsule directory exists in this repo, so no story mapping is available.

## Test Coverage
- `backend/tests/test_ingestion_gateways.py`: add/extend unit tests for Link token webhook fields and invalid-webhook recovery.
- `backend/tests/test_m11_ingestion.py`: existing sync path coverage through fake gateway.
- Gap: live Plaid sandbox behavior is verified manually because it depends on Plaid credentials and network.

## Risk: Medium
Shared Plaid gateway path is used by link-token creation and sync, but the change is isolated to sandbox webhook configuration/retry and covered by gateway tests.

## Recommended action
Proceed with a surgical TDD fix: add failing gateway tests first, patch webhook configuration/retry only, run targeted tests, then run a manual local Plaid sync to verify transactions are created.
