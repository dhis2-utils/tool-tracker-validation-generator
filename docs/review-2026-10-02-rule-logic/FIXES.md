# Fixes — rule logic review (2026-10-02)

All fixes are in `fix: rule conditions match their wording; atomic, conflict-safe writes`.
Numbers refer to `REVIEW-FINDINGS.md`. "Engine" = `@dhis2/rule-engine` 3.8.3, the rule engine
the Capture web app, the Android app and the server use, run inside the unit tests
(`tests/ruleEngine.ts`).

Not fixed, by decision: **LOW 2** (extreme numbers like `1e-7` in the condition). The strict
parser now reads exponents, so such a rule round-trips, but the input is not limited.

## HIGH

| #   | Fix                                                                                                                                                                                                     | Where                                                                            | Verified by                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 1   | Violation operators swapped to match the wording: before `<= 0`, on or before `< 0`, after `>= 0`, on or after `> 0`                                                                                    | `src/lib/builder.ts` (`DATE_VIOLATION_OP`)                                       | engine tests yesterday / today / tomorrow and field-to-field boundary; Capture web R1, R3, R7                           |
| 2   | "Within N units before/after D" is the inclusive window [D − N, D] / [D, D + N], both sides checked; `*Between(addDays(X, ±1), …) >= N` makes weeks, months and years exact (months clamp at month end) | `src/lib/builder.ts` (`generateIntervalCondition`)                               | engine tests incl. an exhaustive check of every reference date in 2028 for all four units; Capture web R2, R6           |
| 3   | `d2:hasValue` guard on every data element / attribute a condition reads (an empty number is 0 in the engine)                                                                                            | `src/lib/builder.ts` (`buildGuards`)                                             | engine tests (empty second field never fires); Capture web R2-A-empty, R5-N-empty                                       |
| 4   | `getConfigErrors` blocks min > max, a date range empty today, intervals / offsets that are not whole numbers ≥ 1 (form, bulk queue, and again in the service)                                           | `src/lib/validation.ts`, `ValidationForm`, `BatchWorkspace`, `services/rules.ts` | unit tests                                                                                                              |
| 5   | Strict parser: a condition is accepted only if the builder regenerates it byte for byte; the validated field's position is fixed by the template                                                        | `src/lib/parser.ts` (new)                                                        | `tests/roundtrip.test.ts`: 562 cases, every operator × target × comparison type, plus foreign / superseded forms → null |
| 6   | Detection is stage-aware and attributes a rule only to the field it validates                                                                                                                           | `src/lib/detector.ts`                                                            | `tests/detector.test.ts` (same data element in two stages)                                                              |

## MEDIUM

| #   | Fix                                                                                                                                                                          | Verified by                                                                                        |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 7   | Update re-reads the rule, refuses when it changed since the page loaded, and sends the fresh action list (actions others added survive)                                      | `tests/services-writes.test.ts`; behaviour verified live on 2.42                                   |
| 8   | Rule + action in one atomic `/api/metadata` import (create and update); PRVs created for a refused rule are deleted; delete sends only the rule (DHIS2 cascades its actions) | `tests/services-writes.test.ts` (fake server modelled on the live-verified behaviour); live probes |
| 9   | Interval rules belong to the guarded field; system dates never validate a rule; other rules reading a field are listed read-only (`prGetReferencing`)                        | `tests/detector.test.ts`                                                                           |
| 10  | Bulk never targets due dates (also enforced in `applyBatchTemplates`); the workspace says so                                                                                 | unit tests; review suite step 8 (6 bulk rules, no due dates)                                       |
| 11  | `V{event_date}` / `V{due_date}` resolve to the rule's stage; unscoped ones are refused                                                                                       | `tests/roundtrip.test.ts`                                                                          |
| 12  | Group edit, delete all and bulk cleanup run every rule and show one summary alert naming the failures                                                                        | review suite steps 6 and 9                                                                         |
| 13  | Relative bounds default to days when editing                                                                                                                                 | unit test                                                                                          |

## LOW

| #   | Fix                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Covered by `getConfigErrors` (interval ≥ 1, whole numbers; the form no longer truncates "1.5" with `parseInt`)                             |
| 3   | Covered by HIGH 2 (exact calendar arithmetic, two-sided)                                                                                   |
| 4   | Strict parser; deleting a rule the tool did not create warns that the whole rule goes, listing all its actions                             |
| 5   | Bulk apply validates the condition with DHIS2 until one rule of each template has actually been checked                                    |
| 6   | Condition check distinguishes invalid (HTTP 200, status ERROR) from "could not check" (401, network, non-JSON); the latter shows a warning |
| 7   | PRVs are created only after duplicate / name / config checks pass, and rolled back if the condition or the import is refused               |
| 8   | Only a 404 means "no programme settings yet"; other errors are shown                                                                       |
| 9   | PRV prefix normalised to `A-Z0-9_`, with a "will be saved as" hint                                                                         |
| 10  | A rule with more than one message can't be edited (reason shown); all its messages are listed                                              |
| 11  | Duplicates compared by exact condition in the same stage                                                                                   |
| 12  | `tests/builder-semantics.test.ts`, `roundtrip.test.ts`, `services-writes.test.ts` (fake server), `settings.test.ts`                        |

## Found during testing

- **Rollback could delete someone else's PRV.** When creating a PRV hit a name conflict, the
  existing PRV was reused, and a later rollback counted it as "created" and deleted it. Rollback
  now only removes PRVs this save actually created, and forgets them from the working copy so a
  later save in the same run recreates them (found in self-review; two regression tests).
- **DHIS2 2.42.6: updating a rule and a field-less action together fails** with
  `NullPointerException … ProgramRule.getProgram() because "rule" is null`, once the rule has been
  read in any way (also for an action-only import). Found by the review suite (editing an
  enrollment-date rule). Reproduced and bisected live; JSON-patching rule and action works. The
  update now tries the atomic import first and, on a 500 (nothing stored), patches the rule then
  the action, restoring the rule if the second patch fails. Worth reporting to DHIS2 core.
- Interval and relative-bound wording: "1 day" / "1 month" instead of "1 days" / "1 months".
