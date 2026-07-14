# Review findings — Tracker Validation Tool (rule behavior, multi-version)

- **Date:** 2026-07-13
- **Scope:** functional testing of the *generated program rules* — do the rules this tool
  creates actually fire correctly at data entry? — across DHIS2 **2.41, 2.42, 2.43**, both via the
  tracker **import API** and the **Capture app** (client-side rule engine).
- **Databases:** a mix — **Laos HMIS demo** (2.41, 2.43) and **Sierra Leone demo** (2.42).
- **Method:** `tests/e2e/rule_behavior_suite.py` (API) and `tests/e2e/capture_rule_test.py`
  (Playwright/Capture), both parameterised and DB-agnostic (auto-discover a tracker programme with
  a numeric + a date field). Assertions key on the *created rule's UID* appearing in the tracker
  import `validationReport` for a violating payload and being absent for a valid payload. All
  created metadata and tracker data is deleted after each run (verified zero leftovers).
- **Baseline:** eslint/prettier clean, `tsc --noEmit` clean, 102 unit tests passing, production
  bundle builds.

## HIGH

### 1. Relative date bounds in months/years are silently non-functional (`d2:addYears`/`d2:addMonths`)
`src/lib/builder.ts` (`getVariableReference`, the `relative_current_date` branch) emits
`d2:addYears(V{current_date}, -N)` or `d2:addMonths(...)` when the relative comparison unit is
years or months. **`d2:addYears` and `d2:addMonths` are not functions the DHIS2 program-rule
engine evaluates** — the rule engine only provides `d2:addDays` for date arithmetic (it has
`d2:yearsBetween`/`d2:monthsBetween` for *differences*, but no add-years/add-months). DHIS2 accepts
and stores such a rule without complaint, but at data-entry time the clause referencing the unknown
function does not evaluate, so **the rule never fires.**

Impact is broad because **the tool's default relative unit is `years`** (the `relativeUnit`/
`upperRelativeUnit` state in `src/components/ValidationForm.tsx` and `buildRelativeDateTarget`
usage default to `'years'`). So the most natural relative configuration — e.g. *"date of reporting
should be within a year of the current date"* or a `between` rule whose lower bound is
*"1 year before current date"* — produces a rule that looks correct in the UI, saves successfully,
and then silently does nothing. A `between` rule with a relative years/months bound is worse than
half-working: the unknown-function clause can make the **entire** compound condition fail to
evaluate, so neither bound is enforced.

**Verified** on all three versions: for a date inside the window, the `addYears`/`addMonths`
variants did **not** fire on import, while the `addDays` and fixed-date-literal variants **did**.
Day-unit relative bounds (`d2:addDays`) work correctly.

**Root cause confirmed in DHIS2 source (not a DHIS2 evaluation bug — the functions do not exist):**
- The shared expression grammar `Expression.g4` (`dhis2/dhis2-antlr-expression-parser`, used by both
  program rules and program indicators) defines exactly one date-arithmetic function, `d2:addDays(`.
  The `*Between` functions compute *differences* only. There is **no `d2:addYears`/`d2:addMonths`**
  anywhere in the grammar or in `dhis2/rule-engine` (0 occurrences).
- DHIS2's own validator agrees: `POST /api/programRules/condition/description` on a
  `d2:addYears(...)` condition returns `status: ERROR — "Unknown function or constant: 'd2:addYears'"`.

**Secondary, DHIS2-side (optional to report, LOW):** `POST /api/programRules` **accepts and stores**
a condition containing the unknown function (observed `HTTP 201`, `errorReports: []`) even though
the description endpoint flags it invalid — so DHIS2 persists a rule whose condition can never
evaluate and then silently never fires. That is a validation-gap in the create/update path
(defense-in-depth); the app must still not emit the function in the first place.

*Suggested fix (a follow-up, not part of this review):* in `getVariableReference`, stop emitting
`d2:addYears`/`d2:addMonths`. Options, in rough order of preference:
1. Restrict the relative-unit selector to **days** only (simplest, fully correct), or
2. translate months/years to an approximate day count in `d2:addDays` (e.g. 30/365) and label it
   as approximate, or
3. re-express the bound with `d2:daysBetween(date, V{current_date})` against a day threshold.
   Whichever is chosen, add a unit test asserting the generated condition uses only rule-engine
   functions, and consider a save-time guard that refuses to persist a condition containing a
   non-engine function.

### Fixes applied (2026-07-14, after the review)

1. **Relative unit limited to days.** The relative current-date bound selector now offers only
   `days` (in `DateComparisonPicker` and the batch workspace); defaults changed from `years` to
   `days`. `d2:addDays` is the only date-arithmetic function the engine supports, so this guarantees
   relative bounds evaluate. (The parser still *reads* legacy `d2:addYears`/`d2:addMonths` rules so
   they can be found and re-saved to a working form. `within N months/years` interval rules are
   unaffected — they use the real `d2:monthsBetween`/`yearsBetween` functions.)
2. **Pre-post condition validation.** Before a rule is created/updated, its condition is validated
   against `POST /api/programRules/condition/description`; an invalid condition aborts with a clear
   message instead of silently persisting a dead rule. Batch apply validates one rule per template
   (siblings share the condition shape). Fails open if the validator endpoint is unreachable.
3. **Option-set numeric fields excluded.** `buildVariablesArray` now skips numeric data
   elements / attributes that carry an option set — the option set already constrains the value, so
   a numeric range rule would be redundant. (Metadata query extended to fetch `optionSet[id]`.)

## What works correctly (verified, all three versions, API + Capture)

These rule shapes — all produced by the tool — fire and block on a violating value and stay silent
on a valid one, on 2.41 / 2.42 / 2.43, via the import API; the date `before current date` rule was
additionally confirmed firing client-side in the **Capture** app on 2.42 and 2.43:

- Date **before / on-or-before / after / on-or-after** a fixed date or the current date.
- Date **between** two **fixed-date** (or current-date / day-relative) bounds, inclusive.
- Numeric **comparison** (`>`, `>=`, `<`, `<=`, `==`, `!=`) against a fixed value.
- Numeric **between** (`>= min && <= max`), inclusive.

Server-side (import) enforcement: a met `SHOWERROR` returns `status: ERROR` with an `E1300`
report naming the rule and blocks the write (`created: 0`); a `SHOWWARNING` would warn and allow.
Client-side (Capture): the rule's message appears in the Errors widget at data entry.

## Notes / environment quirks (not app defects)

- **Capture secure-context requirement (2.43):** Capture's App-Platform build refuses to load over
  a non-`localhost` origin ("application could not be loaded"). The Capture test opens an
  in-process loopback tunnel to the dev-net instance so the browser sees a secure `localhost`
  origin. Not an app issue; relevant only to automated testing.
- **Global-shell iframe (2.42+):** installed apps (including Capture) render inside the global-shell
  iframe; tests locate the app frame via `page.frames`.
- Numeric attributes are not rendered in some demo registration forms, so client-side firing was
  demonstrated with a date rule (also a tool format); numeric client-side behaviour is covered by
  the server-side import tests.

See `UI-TEST-RESULTS.md` for the per-version matrix and screenshots, and `STATE-CHANGES.md` for
instances and test data created/deleted.
