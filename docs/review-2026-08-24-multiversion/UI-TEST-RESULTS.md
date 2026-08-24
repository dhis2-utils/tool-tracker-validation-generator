# E2E test results — DHIS2 2.41 / 2.42 / 2.43

**Date:** 2026-08-24
**Build under test:** branch `review/rule-behavior-fixes-2026-07` at `92852a8`
(default-text template rework + event-programme support), production bundle
`tool-tracker-validation-1.0.0.zip` installed via `POST /api/apps` on each
instance and driven as the installed app.
**Baseline:** 153 unit tests pass, `tsc --noEmit` clean, eslint + prettier
clean, bundle builds.

## Matrix

| DHIS2    | Instance                   | Seed             | Programme driven                   | Suite                              | Result         |
| -------- | -------------------------- | ---------------- | ---------------------------------- | ---------------------------------- | -------------- |
| 2.41.9.1 | `agent-tv-41`              | Sierra Leone v41 | Child Programme                    | `review_suite.py` (11 steps)       | **11/11 PASS** |
| 2.41.9.1 | `agent-tv-41`              | Sierra Leone v41 | Inpatient morbidity and mortality  | `event_program_suite.py` (6 steps) | **6/6 PASS**   |
| 2.42.5.2 | `agent-tracker-validation` | Laos HMIS v42    | Electronic Immunization Registry   | `review_suite.py` (11 steps)       | **11/11 PASS** |
| 2.42.5.2 | `agent-tracker-validation` | Laos HMIS v42    | RMS - Rapid Mortality Surveillance | `event_program_suite.py` (6 steps) | **6/6 PASS**   |
| 2.43.1   | `agent-tv-43`              | Sierra Leone v43 | Child Programme                    | `review_suite.py` (11 steps)       | **11/11 PASS** |
| 2.43.1   | `agent-tv-43`              | Sierra Leone v43 | Inpatient morbidity and mortality  | `event_program_suite.py` (6 steps) | **6/6 PASS**   |

**Every step passed on every version: 51 of 51 checks.** No non-benign
console errors and no page errors on any run. Every created
object (rules, actions, program rule variables, dataStore config) was deleted
after each run.

## What each suite covers

`tests/e2e/review_suite.py` — the documented happy paths, each mutation
verified by reading the metadata back through the API:

1. app loads with the empty state
2. selecting a programme loads the overview
3. overview lists variables, stages expand, settings warning shows
4. programme settings persist to the dataStore
5. create a date rule — UI plus the exact stored condition
6. edit a rule and change its action type
7. create a numeric rule — inverted condition plus the bound program rule variable
8. bulk apply covers every unvalidated date variable
9. adding a specific rule offers to remove the redundant bulk rule
10. delete a rule from the UI
11. the overview shows per-variable rule-count tags

`tests/e2e/event_program_suite.py` — event-programme support added in
`92852a8`:

1. the event programme is selectable and labelled "(event programme)"
2. programme settings save for it
3. enrollment and incident dates are **not** offered
4. the stage's date fields are offered
5. a date rule persists with the right condition
6. the rule name carries **no** stage suffix (single-stage programme)

## Corrections made to the committed suite

The in-repo suite was stale in three ways and would have failed against the
current build. These were fixture bugs, not app defects:

1. **App key.** The suite drove `/api/apps/tracker-validation-tool/index.html`;
   the app was renamed in `bf74987`, so the key is now
   `tool-tracker-validation`.
2. **Pre-fix numeric expectation.** It asserted the stored condition for
   "greater than 300" was `#{x} > 300`. Since `b2bddbf` ("numeric and between
   rules fire on the violation, not on satisfaction") the correct condition is
   `#{x} <= 300` — the suite predates that fix and encoded the bug. It also
   assumed a freshly created prefixed program rule variable; the app reuses an
   existing variable bound to the same data element when one exists (Laos EIR
   ships `birth_weight`). The assertion now checks the condition _shape_ and
   that whichever variable was used really points at the field under test.
3. **Hand-counted bulk expectation.** The expected number of bulk rules was a
   per-programme constant. It is now derived from the instance's own metadata
   at run time (`expected_unvalidated_dates()`), which independently reproduced
   the original value of 5 for Child Programme and caught that my own
   hand-count for the Laos programme was wrong (7, not 6 — I had missed its
   DATE tracked entity attribute).

The suite is also now parameterised by `PROFILE` (`sl` / `laos`) so the same 11
steps run against either demo database.

## Environment notes (not app defects)

- **Chromium in this container needs `--disable-dev-shm-usage`.** `/dev/shm` is
  64 MB, and without the flag the tab dies mid-run with "Page crashed".
- **Capture requires a secure context.** Its App-Platform build refuses to load
  over a non-`localhost` origin ("The application could not be loaded"). The
  screenshot script opens an in-process loopback TCP forwarder so the browser
  sees `localhost`. Same finding as the July review.
- **Metadata Management renders in the global-shell iframe**, and the shell
  frame also carries the app title — match on the list's own search box when
  locating the app frame, or every subsequent click misses.
- **Old-app screenshots need `animations="disabled"`**; their spinners never let
  the page reach the stable state a screenshot waits for, so the call times out.
- **Capture shows a data element's form name**, which can differ from the
  metadata name the tool shows ("Date of discharge" vs "Discharge Date").
- **`allowFutureDate` pre-empts the rule engine.** A future value in a field
  configured with `allowFutureDate = false` is rejected by Capture before any
  program rule is evaluated, so such a rule can never be _observed_ firing on a
  future value. The tool already warns about this contradiction; the Capture
  screenshot therefore demonstrates a fixed lower bound instead.
- **The app renders top-level on 2.41 and inside the global-shell iframe on
  2.42+**; the suites locate the app frame via `page.frames` and so pass on
  both without change.
- `tsconfig.json` includes only `src` and `types`, so **test files are not
  type-checked** — a fixture can reference a field that does not exist on the
  type without `tsc` complaining. Worth fixing separately.
