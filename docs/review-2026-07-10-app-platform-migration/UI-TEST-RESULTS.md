# UI test results — Tracker Validation Tool

- **Suite:** `tests/e2e/review_suite.py` (Playwright, frame-aware for the 2.42+ global shell)
- **Deployment under test:** production zip built by `d2-app-scripts build`, installed via
  `POST /api/apps` on each instance (204 on 2.41, 201 on 2.42/2.43 — as expected)
- **Instances:** broker-created, Sierra Leone demo seed per version, credentials `local_admin`
- **Test data:** demo *Child Programme* (`IpHINAT79UW`) — enrollment/incident dates, stages
  *Birth* and *Baby Postnatal*, NUMBER data elements
- Every mutation asserted through the API afterwards, not just through the UI.

| # | Flow | 2.41.9 | 2.42.5.1 | 2.43.0.1 |
|---|------|--------|----------|----------|
| 1 | App loads with empty state | PASS | PASS | PASS |
| 2 | Programme selection loads overview | PASS | PASS | PASS¹ |
| 3 | Overview: variables, stage expansion, settings warning | PASS | PASS | PASS |
| 4 | Settings saved to dataStore (verified via API) | PASS | PASS | PASS |
| 5 | Create date rule; condition `d2:daysBetween(V{enrollment_date}, V{current_date}) <= 0` | PASS | PASS | PASS |
| 6 | Edit rule → action type becomes SHOWWARNING (API-verified) | PASS | PASS | PASS |
| 7 | Create numeric rule; PRV `TVT_BIRTH_MCH_WEIGHT_G` created with prefix | PASS | PASS | PASS |
| 8 | Batch apply: exactly 5 rules for unvalidated dates² | PASS | PASS | PASS |
| 9 | Specific rule triggers batch-cleanup offer; batch rule removed³ | PASS | PASS | PASS |
| 10 | Delete rule via UI confirm modal (API-verified) | PASS | PASS | PASS |
| 11 | Overview shows rule-count tags | PASS | PASS | PASS |
| — | Console errors (non-benign) / page errors | 0 / 0 | 0 / 0 | 0 / 0 |

¹ Initially FAILED on 2.43: `programRuleActions?filter=programRule.program.id:eq:X` returns 400
on 2.43 (finding 5). Fixed by fetching actions nested under rules; the table shows the result
with the fix, and 2.41 was re-verified on a fresh instance afterwards (`2.41-final` run).

² Verifies the current-date pseudo-variable exclusion (finding 3): incident date + 2× event
date + 2× due date, and no rule targeting `V{current_date}`.

³ Initially the "deleted" confirmation alert never appeared (finding 6); fixed and re-verified.

Screenshots per step and per version (`<label>-NN-*.png`) and machine-readable results
(`results-<label>.json`) sit alongside this file. The suite is parameterized via `DHIS2_URL`,
`DHIS2_USER`, `DHIS2_PASS`, `LABEL`, `OUTDIR` and cleans up everything it creates (rules,
actions, PRVs, dataStore key) regardless of pass/fail.

### Not covered (manual/API checks or unit tests instead)

- Rule editing with fixed/relative comparison targets (unit-tested in `tests/validation.test.ts`)
- Programme-rule *variable* name-conflict retry path (unit-tested in `tests/services-rules.test.ts`)
- Dev-server (`d2-app-scripts start`) serving — smoke-checked during development; the reviewed
  artefact is the production bundle
