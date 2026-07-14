# Review findings — Tracker Validation Tool (App Platform migration)

- **Date:** 2026-07-10/11
- **Scope:** code review + functional test + architecture assessment, DHIS2 2.41 / 2.42 / 2.43
- **Commit reviewed:** `feat/app-platform-migration` branch (post-migration)
- **Baseline before review:** eslint clean, `tsc --noEmit` clean, 79 unit tests passing, production build OK

This review covered the freshly migrated DHIS2 App Platform (React/TypeScript) version of the
tool. **All findings below were fixed during the review** (commits `37c00b5`, `419325c`,
`5a51696`-range on the same branch) and verified by unit tests plus the full e2e suite on all
three DHIS2 versions. Severity reflects the state _before_ the fix.

## HIGH

### 1. `within_before` rules were invisible after creation

`src/lib/detector.ts` — the builder deliberately places the validated variable as the _second_
`d2:*Between` argument for `within_before` conditions, but the detector only ever matched the
first argument. A "date X within 30 days before Y" rule vanished from X's details page and rule
counts, and the batch workspace kept treating X as unvalidated. With fixed/relative comparison
targets the rule matched _no_ variable at all. **Carried over from the vanilla app.**
_Fix:_ detector now parses conditions with the shared depth-aware `parseBetweenExpression` and
attributes interval conditions (`> N`, N>0) to either argument.

### 2. `due_date` rules undetectable and unscoped

`src/lib/detector.ts`, `src/services/rules.ts` — the detector had no `due_date` branch, so due-date
rules never appeared as validations and could not be edited or deleted from the app; and rule
creation didn't set `programStage` for due-date targets, so each rule fired in _every_ stage.
**Carried over from the vanilla app.**
_Fix:_ `due_date` branch with stage scoping added to the detector; `programStage` set on creation.

### 3. Batch apply created a nonsense rule for the "Current date" pseudo-variable

`src/lib/validation.ts` — the synthetic `current_date` entry in the variables array was treated as
an unvalidated date, so a programme-wide batch template wrote a junk rule (e.g.
`d2:daysBetween(V{current_date}, '2030-01-01') < 0`) that was invisible in the UI and could not be
removed through the app. **Carried over from the vanilla app.**
_Fix:_ `getUnvalidatedVariables` excludes comparison-only pseudo-variables. Verified live: batch
apply on the demo Child Programme now creates exactly 5 rules (incident + 2×event + 2×due dates).

### 4. Editing state survived route changes and could rewrite the wrong rule

`src/pages/DetailsPage.tsx` — the details route element stays mounted across param-only navigation
(browser back/forward), so a rule loaded for editing on variable X could be "updated" while
viewing variable Y, rewriting the rule's condition to target the wrong variable. The form remount
key also omitted `stageId`, so the same data element in two stages shared form state.
**Migration-specific.**
_Fix:_ edit/confirm state cleared on route-param change; `stageId` added to the form key.

### 5. `programRuleActions` query returns 400 on DHIS2 2.43

`src/hooks/useProgramMetadata.ts` — `GET /api/programRuleActions?filter=programRule.program.id:eq:X`
works on 2.41/2.42 but 400s on 2.43.0.1 ("Unable to locate Attribute [program] on ManagedType
ProgramRuleAction"), making the app unable to load any programme on 2.43. **Found by the
multi-version functional pass** — the same query pattern exists in the vanilla app, which is
therefore also broken on 2.43.
_Fix:_ actions are now fetched nested under their rules
(`programRules?fields=:owner,programRuleActions[:owner]`) and flattened — verified on all three
versions (and it saves a request).

## MEDIUM

### 6. Consecutive alerts were swallowed

`src/hooks/useValidationActions.ts` — all mutations shared one `useAlert` instance;
`@dhis2/app-runtime` manages a single alert per instance and ignores `show()` while that alert is
visible. The "deleted successfully" confirmation immediately after "created successfully" (the
batch-cleanup flow) never appeared. **Found by e2e testing; migration-specific.**
_Fix:_ one `useAlert` instance per mutation outcome.

### 7. Unhandled promise rejections on failed mutations

`src/pages/DetailsPage.tsx` — `mutateAsync` calls were awaited without try/catch; any server error
produced an unhandled rejection (the user-facing alert was already handled by the hook).
_Fix:_ rejections caught at all call sites; the cleanup loop closes its modal in `finally`.

### 8. Batch workspace stage selection leaked across programme switches

`src/components/BatchWorkspace.tsx` — the overview stays mounted when the header switches
programme, so a stage id from programme A could be submitted in a template for programme B.
_Fix:_ stage selection reset on programme change and guarded against unknown ids.

### 9. Duplicate detection missed stage-scoped comparisons

`src/lib/signature.ts` — `findDuplicateRule` compared a stage id parsed from PRV metadata (always
absent for this app's PRVs) against the form's stage id, so duplicate detection silently fell back
to name matching only. _Fix:_ missing stage on either side now counts as a match.

### 10. Numeric rules had no duplicate pre-check

`src/services/rules.ts` — the date path checks for duplicates and name collisions before writing;
the numeric path went straight to the server and surfaced duplicates as raw 409s after PRV work
had already run. _Fix:_ equivalent pre-check added for numeric rules.

## LOW / notes

- `@dhis2/ui` `InputField` labels are not programmatically associated with their inputs (no
  `for`/`id` pairing) — an upstream library accessibility gap, noted here because it also forces
  tests to select by placeholder. Passing a `name` prop to each field would restore the pairing;
  left as a follow-up.
- Benign console noise when running installed on plain HTTP: the platform's PWA layer warns
  "window is not a secure context", and the SL demo instance 404s its own `staticContent/logo_banner`.
  Neither is an app defect.
- Build emits a >500 kB main chunk warning (platform + @dhis2/ui baseline). Not worth code-splitting
  for an admin tool of this size.

## Claims investigated and rejected

- _"TanStack Query keys / invalidation / structuredClone working-copy handling are incorrect"_ —
  reviewed explicitly; correct as written (confirmed by an independent review agent and live tests).
- _"@dhis2/ui prop misuse in selects/modals/buttons"_ — none found; `tsc` against the library's
  bundled types plus live rendering on three versions surfaced no prop errors.

## Architecture assessment

**The App Platform is the right architecture for this app, and the migration should be kept.**
The tool needs the DHIS2 look-and-feel, runs against three server versions with real API drift
(see finding 5 — caught and absorbed in one hook rather than a hand-rolled fetch layer), persists
metadata through multi-step flows, and benefits from i18n and App Hub distribution. The migration
preserved the tested pure business logic (`src/lib`, 84 unit tests) and replaced the DOM-wiring
layer — the area where all pre-existing bugs above lived — with typed React components.

Costs already paid: full UI rewrite (~2.5k lines), new data layer, test port. Remaining costs:
none structural; the vanilla branch history remains in git for reference.
