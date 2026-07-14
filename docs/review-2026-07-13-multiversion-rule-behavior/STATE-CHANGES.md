# State changes — 2026-07-13/14 multi-version rule-behavior review

## Broker instances

| Instance             | Version | Seed                | Purpose                          | Final state                                  |
| -------------------- | ------- | ------------------- | -------------------------------- | -------------------------------------------- |
| agent-review-sl-42   | 2.42.5  | Sierra Leone v42    | 2.42 testing                     | **Deleted**                                  |
| agent-review-laos-41 | 2.41.9  | Laos v41            | 2.41 testing                     | **Deleted**                                  |
| agent-laos-v43       | 2.43.0  | Laos v41 → migrated | 2.43 testing + user's dev server | **Left running** (pre-existing this session) |

Note: `agent-laos-v43` was stopped by the host (resource management) partway through the review and
**restarted** so the user's dev server keeps working. It was not created for this review and is
intentionally left running.

## Test metadata / tracker data

All created via the API in the tool's rule formats, tagged with unique markers (`RBT-*`,
`CAPRBT-*`), and deleted after each run:

- Program rules, program rule variables, program rule actions — created and deleted per run.
- Tracked entities / enrollments / events — violating imports were blocked (never persisted);
  valid imports were deleted via `importStrategy=DELETE`; Capture never saved an enrollment.
- One manual probe program rule (`d2:addYears` create-validation check) created on
  agent-review-laos-41 and deleted (HTTP 201 create, 200 delete).

Independent post-run sweeps on each instance reported **0 leftover** rules / PRVs / actions / TEIs
for every marker used. Nothing test-created remains.

## System settings

- This review changed **no** system settings.
- Pre-existing (from earlier in the session, not this review): `agent-laos-v43`
  `/api/configuration/corsWhitelist` includes `http://localhost:49223` (added to let the dev server
  talk to the instance). Still present; harmless. Left as-is because the dev server still uses it.

## Repository additions (not yet committed)

- `tests/e2e/rule_behavior_suite.py` — parameterised, DB-agnostic API rule-behavior suite.
- `tests/e2e/capture_rule_test.py` — Playwright Capture-app rule-firing test.
- `docs/review-2026-07-13-multiversion-rule-behavior/` — this review (findings, results,
  state-changes, screenshots, `api-results-*.txt`).

These are worth keeping as re-runnable acceptance tests (parameterised by env var, no hard-coded
hosts). Offered to commit; awaiting the user's go-ahead.
