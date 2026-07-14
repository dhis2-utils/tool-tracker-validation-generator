# UI / functional test results — rule behavior across versions

Scope: verify that the program rules the tool generates actually fire at data entry — via the
tracker **import API** (server-side rule engine) and the **Capture app** (client-side rule engine).
Rules were created in the tool's exact condition formats, tagged with a unique marker, and deleted
after each run. Assertions key on the created rule's own UID appearing in the import
`validationReport` for a violating payload and being absent for a valid one.

Harness: `tests/e2e/rule_behavior_suite.py` (API), `tests/e2e/capture_rule_test.py` (Capture).
Both parameterised (`DHIS2_URL`/`DHIS2_USER`/`DHIS2_PASS`/`LABEL`/`OUTDIR`) and DB-agnostic
(auto-discover a WITH_REGISTRATION programme with a numeric + a date field).

## Instances / data

| Version | Database | Instance | Programme auto-discovered | Numeric field | Date field | Login |
|---|---|---|---|---|---|---|
| 2.41.9 | Laos HMIS demo | agent-review-laos-41 | AFI – Acute Febrile Illness | Age (Years) [INT≥0] | GEN - Date of birth | local_admin |
| 2.42.5 | Sierra Leone demo | agent-review-sl-42 | MNCH / PNC (Adult Woman) | Height in cm [NUMBER] | Date of birth | admin |
| 2.43.0 | Laos HMIS demo | agent-laos-v43 | Case Surveillance: Mpox (CRF) | MPOX CS: Age (months) [INT+] | GEN - Date of birth | local_admin |

## API (import) — server-side rule engine

Each rule: violating import → `status ERROR`, this rule's `E1300` present, `created 0`, TEI not
persisted (404); valid import → `OK`, this rule's `E1300` absent, created. Result files:
`api-results-2.41.txt`, `api-results-2.42.txt`, `api-results-2.43.txt`.

| Rule (tool format) | 2.41 | 2.42 | 2.43 |
|---|---|---|---|
| Date **before current date** (`daysBetween(d, V{current_date}) < 0`) | ✅ | ✅ | ✅ |
| Date **between**, fixed/current bounds inclusive (`… <= 0 && … >= 0`) | ✅ | ✅ | ✅ |
| Numeric **comparison** (`#{v} > N`) | ✅ | ✅ | ✅ |
| Numeric **between** (`#{v} >= min && #{v} <= max`) | ✅ | ✅ | ✅ |
| **Per-version total** | **8/8** | **8/8** | **8/8** |

## Capture app — client-side rule engine

A tool-generated `SHOWERROR` date rule ("date of birth must not be in the future"); a future DOB
was entered and the rule's message was asserted present in the Capture Errors widget. Auth by
Basic-auth `GET /api/me` cookie injection (no login form). Capture served inside the global-shell
iframe on 2.42/2.43; on 2.43 a loopback tunnel was used to satisfy Capture's secure-context
requirement (test-harness detail, not an app issue).

| Check | 2.41 | 2.42 | 2.43 |
|---|---|---|---|
| Rule message shown at data entry for a violating value | ✅ | ✅ | ✅ |
| Screenshot | capture-2.41-date_before_current.png | capture-2.42-date_before_current.png | capture-2.43-date_before_current.png |

Screenshots are in `./screenshots/`.

## Not working (see REVIEW-FINDINGS.md #1)

- Date rules using a **relative current-date bound in months or years** (`d2:addYears`/
  `d2:addMonths`) — **do not fire on any version**. These functions do not exist in DHIS2; the
  engine only has `d2:addDays`. Reproduced on 2.41, 2.42, 2.43. The suite therefore exercises the
  `between` rule with fixed-date bounds (also a tool format), which fire correctly.

## Coverage notes

- Numeric attributes are not rendered in the demo registration forms used, so client-side firing
  was demonstrated with a date rule (also a tool format); numeric client-side behaviour is covered
  by the server-side import tests, which exercise the numeric rule engine directly.
- All runs cleaned up: every run reported zero leftover rules/PRVs/tracker data, confirmed by an
  independent post-run sweep per instance.
