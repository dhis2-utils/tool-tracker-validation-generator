# State changes made during this review

## Broker instances

| Instance | Action | Status at end of review |
|---|---|---|
| `agent-review-41` (2.41.9, SL demo seed) | created, used, deleted; re-created for the final verification run, deleted again | **deleted** |
| `agent-review-42` (2.42.5.1, SL demo seed) | created, used | **deleted** |
| `agent-review-43` (2.43.0.1, SL demo seed) | created, used | **deleted** |
| `agent-android-test` (pre-existing, not created by this review) | stopped to free resources during the review | **restart issued** (job j-7565d519) |
| `agent-laos-hmis` (pre-existing, not created by this review) | stopped to free resources during the review | **restart issued** (job j-e08c820a) |

## Data/metadata on test instances

All mutations were made only on the disposable `agent-review-*` instances:

- dataStore key `tracker-date-validation/config-IpHINAT79UW` — created by tests, deleted by the
  suite's cleanup on every run
- Program rules/actions tagged `[DVT]` and PRVs prefixed `TVT_` on *Child Programme* — created by
  tests, deleted by the suite's cleanup on every run (verified: 0 left after each run)
- App `tracker-validation-tool` installed via `POST /api/apps` — uninstalled (204) before instance
  deletion on the final instance; other instances were deleted outright

No user-supplied or production instance was touched. No system settings (CORS, feature flags)
were changed anywhere.

## Repository

- Review fixes committed to `feat/app-platform-migration` (see REVIEW-FINDINGS.md)
- E2E suite added at `tests/e2e/review_suite.py`
- This review folder added under `docs/review-2026-07-10-app-platform-migration/`
