# Review findings — Tracker Validation Tool (rule logic and mutation safety)

- **Date:** 2026-10-02
- **Scope:** static code and logic review of `src/` at `b217977` (latest `origin/main`). The focus is
  generated program-rule conditions (anything that can wrongly block data entry or silently fail to
  validate) and the safety of metadata writes. Two independent review passes were run, and every
  HIGH claim was checked live on a disposable DHIS2 **2.42.6** instance (Laos HMIS demo seed),
  either with the server-side rule engine (tracker import of a tracked entity + enrollment) or
  directly through the metadata API.
- **Baseline:** 153 unit tests pass, `tsc --noEmit` clean, eslint + prettier clean, bundle builds.
- **Not yet done:** the Capture web app and Android Capture app (client-side rule engines) have not
  been tested. That is the next step, after the fixes.

`d2:daysBetween(a, b)` is `b − a` throughout (DHIS2 docs, and confirmed live below).

## HIGH

### 1. before / after / on or before / on or after are off by one day — "on or before today" rejects today

`src/lib/builder.ts:85-96`, mirrored by the parser at `src/lib/signature.ts:287-294`.

| UI wording       | Generated violation condition | Fires when | Should fire when |
| ---------------- | ----------------------------- | ---------- | ---------------- |
| X before Y       | `daysBetween(X, Y) < 0`       | X > Y      | X ≥ Y            |
| X on or before Y | `daysBetween(X, Y) <= 0`      | **X ≥ Y**  | X > Y            |
| X after Y        | `daysBetween(X, Y) > 0`       | X < Y      | X ≤ Y            |
| X on or after Y  | `daysBetween(X, Y) >= 0`      | **X ≤ Y**  | X < Y            |

The strict and inclusive comparison operators are swapped. **Verified live** (2.42.6, server-side rule engine, rules in the exact
builder form, Y = current date):

| Date entered | before | on or before | after | on or after |
| ------------ | ------ | ------------ | ----- | ----------- |
| yesterday    | ok     | ok           | FIRES | FIRES       |
| **today**    | ok ✗   | **FIRES ✗**  | ok ✗  | **FIRES ✗** |
| tomorrow     | FIRES  | FIRES        | ok    | ok          |

The most natural "no future dates" rule, _"must be on or before current date"_, therefore
**blocks entry of today's date**. The same goes for any field-to-field comparison where the dates are
equal (e.g. "visit date on or after enrollment date" rejects a same-day visit). The strict operators
let the boundary day through.

How earlier testing missed it: `rule_behavior_suite.py` only used dates far from the boundary
(4 years ahead, 30 days back), and the unit tests assert the generated _string_, not its
meaning. `review_suite.py` creates exactly the "on or before current date" rule on enrollment date.

_Fix:_ swap the four mappings in the builder and the parser together. Add unit tests that evaluate
the condition semantically (yesterday / today / tomorrow) rather than comparing strings. **Existing
rules on live servers keep the old behaviour.** See [Migration](#migration-of-rules-already-on-live-servers).

### 2. "within N … before/after" checks the opposite direction

`src/lib/builder.ts:97-111`; parser `src/lib/signature.ts:295-314, 357-366`.

"X within 30 days after Y" (described to the user as "X is no more than 30 days after Y") generates
`daysBetween(X, Y) > 30`, i.e. fires when **Y − X > 30**, which means X is more than 30 days _before_ Y.
`within_before` is the mirror image. **Verified live** (Y = enrollment date 2024-01-01):

| X entered             | within 30 days after | within 30 days before |
| --------------------- | -------------------- | --------------------- |
| 60 days after enrol.  | ok ✗                 | **FIRES ✗**           |
| 61 days before enrol. | **FIRES ✗**          | ok ✗                  |
| 14 days after enrol.  | ok                   | ok                    |

So these rules block valid data (e.g. "sample date within 30 days before enrollment" rejects any
sample taken more than 30 days _after_ enrollment) and let the intended violations through.

_Fix:_ swap the argument order in both builder branches and the parser's direction logic. Add
semantic tests.

### 3. Field-to-field numeric rules block entry when the second field is empty

`src/lib/builder.ts:180-192` (`generateNumericFieldCondition`).

"Diastolic less than Systolic" generates `d2:hasValue(#{DIA}) && #{DIA} >= #{SYS}`. Only the
validated field is guarded. **Verified live:** an empty numeric variable evaluates as `0`
(`#{N} == 0` and `#{N} < 1` both fire when N is empty), so with Systolic optional and still empty,
every Diastolic value ≥ 0 shows the error.

The same gap exists for date comparisons against an optional data element / attribute
(`buildNullGuard`, `builder.ts:66-72`, guards only the first variable). How the engine evaluates
`daysBetween` with an empty date is **not yet verified**: the server-side import didn't evaluate
data-element rules in the probe, so this is to be checked in Capture / Android.

_Fix:_ add `d2:hasValue(var2)` whenever the comparison side is a data element or attribute (dates
and numbers). The parser's `stripNullGuard` must accept the double guard.

### 4. A rule whose min is greater than its max blocks every value

`src/lib/validation.ts:555-631`, `src/components/BatchWorkspace.tsx:121-131`.

Numeric between with min 10 and max 5 generates `#{X} < 10 || #{X} > 5`, which is true for every number.
Date between with fixed or relative bounds in the wrong order behaves the same way. Nothing in the form or the
batch workspace rejects it, and the server's condition validator accepts it (it is syntactically
valid). One typo blocks all data entry on that field (on every form, for bulk rules).

_Fix:_ refuse to save when min > max, or when both date bounds are literals / relative offsets in
the wrong order. For field-based bounds, show a warning.

### 5. Editing a "within N days before" rule can silently disable it

`src/lib/signature.ts:295-333`. In the `daysBetween` branch, `within_before` is chosen but
variable1 / variable2 are not swapped, unlike the weeks/months/years branch at 357-366. The edit form then
compares the field with **itself**. Changing only the message or action type and saving rewrites
the live rule to `d2:hasValue(#{X}) && d2:daysBetween(#{X}, #{X}) > 30`, which never fires. Confirmed by
running the real parser and builder (probe test). The existing test (`signature.test.ts:117`) checks
only the operator.

_Fix:_ swap the variables in the days branch. Add a parse → edit config → rebuild round-trip test
for every operator. With finding 2 fixed, every round trip must reproduce the condition exactly.

### 6. Rule detection ignores the programme stage, so the cleanup offer can delete another stage's rule

`src/lib/detector.ts:31-36` (PRVs matched by data element id only; `rule.programStage` checked only
for event / due date), used by `src/pages/DetailsPage.tsx:159-165` and `RulesPage.tsx:70-75`.

When the same data element is used in two stages (e.g. "Visit date" in ANC and PNC), a rule
scoped to PNC is listed as a rule of the ANC variable. Concretely (confirmed with the real detector):

- After a bulk run, adding a specific rule on ANC "Visit date" triggers the cleanup offer _"This
  variable has 2 batch rules. Remove them?"_. Confirming deletes the **PNC** bulk rule too, and
  PNC loses its validation.
- "Edit all in group" and editing from the ANC page rewrite the PNC rule's name / message as "Visit
  date (ANC) …".
- A rule on ANC makes the PNC variable look validated, so bulk apply silently skips it.

The related PRV list also includes PRVs of _any_ source type (e.g. a user's
`DATAELEMENT_PREVIOUS_EVENT` PRV), so rules the app did not create get attributed to the field (see LOW 4).

_Fix:_ for data elements require `!rule.programStage || rule.programStage.id === variable.stageId`.
Restrict related PRVs to the source types the app itself uses. Scope the cleanup to the same stage.

## MEDIUM

### 7. Editing a rule PUTs a stale copy, which deletes actions added since the page loaded

`src/services/rules.ts:685-690, 753-775`; cache from `src/hooks/useProgramMetadata.ts:57-60`.
The update sends `{...existingRule, name, description, condition}`, where `existingRule` comes from
the TanStack cache **including its nested `programRuleActions`**. **Verified live:** after another
admin (or the maintenance app) added an action to the rule, a PUT of the cached copy returned 200
and **deleted that action outright** (404 afterwards, not just detached). Any other field changed
since the cache loaded (priority, programStage, description) is also reverted.

_Fix:_ re-GET the rule (`fields=:owner`) right before updating and drop `programRuleActions` from
the body. Or use JSON Patch for `name`, `description` and `condition` only.

### 8. Rule and action are written separately, so a failure leaves half-written metadata

`src/services/rules.ts:312-342, 770-781, 844-853`. Create = POST rule, then POST action. If the
action fails, the rule exists without an action, which the detector ignores (it is invisible, can't be edited or
deleted in the app), and with no prefix every retry fails on the duplicate name (server enforces unique rule
names; verified, 409). Update = PUT rule, then PUT action. A failure in between leaves the new condition
with the old message (e.g. operator changed from before to after, message still "must be before").

_Fix:_ write the PRV(s), rule and action in one `POST /api/metadata?atomicMode=ALL` with UIDs from
`/api/system/id`, and check the import report. The rule delete should send only the rule:
`DELETE /programRules/{id}` cascades to its actions (verified). Deleting the actions first, as
now, can leave a rule stripped of its message when the final delete fails.

### 9. Interval rules are attributed to the comparison field or system date, and editing from there strips the null guard

`src/lib/detector.ts:170-175`, first-match at `RulesPage.tsx:70-75`. `isIntervalExpression` claims
both arguments, so a rule validating X against Y is listed (and editable) under Y. A bulk "within N
days of current date" rule is listed under _Current date_. Editing it from there rebuilds the
condition with the system date as the validated variable, **without** `d2:hasValue(#{X})`
(`buildNullGuard` skips system variables), and rewrites the user-facing message from the wrong side.

_Fix:_ attribute an interval rule to the guarded variable (the one in `d2:hasValue`). Never offer
edit or cleanup from a system-variable page.

### 10. Bulk "no future dates" templates also land on due dates

`src/lib/validation.ts:241-271, 646-661`. Bulk targets include each stage's `due_date`, and the future-date
skip only checks `futureDatesAllowed`, which due dates never have. The result is
`daysBetween(V{due_date}, V{current_date}) < 0` scoped to the stage, so every scheduled event opened
before its due date shows an error not attached to any field. To be confirmed in Capture.

_Fix:_ exclude `due_date` from future-rejecting templates (arguably from bulk entirely).

### 11. Due-date and event-date rules don't parse back correctly

`src/lib/signature.ts:457-478`: `V{due_date}` is not handled, so due-date rules can't be edited,
show as raw conditions, and escape duplicate detection. `signature.ts:469`: `V{event_date}`
parses to id `event_date` while the app's variables are `event_date_<stageId>`, so editing a
comparison against event date throws "Target date not found", and duplicates aren't detected.

_Fix:_ handle `due_date`. Resolve event and due date to the rule's `programStage`.

### 12. Multi-rule operations give unreliable feedback

`src/pages/RulesPage.tsx:160-170, 220-250`. Group edit shows one alert per outcome type
(`useAlert` ignores `show()` while visible), so later failures are dropped and none name the rule.
"Updated successfully" can appear alongside a failure. Delete-all and cleanup stop at the first
failure without saying which rule failed or what is left.

_Fix:_ collect per-rule results and show one summary, as `applyBatchTemplates` already does.

### 13. Switching an edited rule to a relative bound labels it in years while the condition uses days

`src/lib/validation.ts:766, 777` default `relativeUnit` to `'years'` in `buildEditConfig`. The
condition is `d2:addDays(V{current_date}, -18)`, but the name and message say "18 years before
current date". That message is what data-entry users see.

_Fix:_ default to `'days'`, matching the pickers.

## LOW

1. **Negative interval amounts accepted** (`ValidationForm.tsx:171`, `BatchWorkspace.tsx:195`).
   `> -5` fires on nearly everything. Clamp the amount to ≥ 1.
2. **Extreme numbers don't round-trip** (`builder.ts:167`; parser regexes `signature.ts:223-224, 400`
   are unanchored and don't accept exponents). `1e-7` is emitted, then parsed back as `1`, so an edit changes
   the rule.
3. **"Within N months/years" is lenient and one-sided.** `monthsBetween > 3` truncates (allows up to
   about 3 months 29 days), and a date on the wrong side of the anchor is never caught. Wording / docs.
4. **Rules the app didn't create can be misattributed, and Delete is offered for them.** The patterns are
   unanchored (`detector.ts:179`, `signature.ts:380-418`), and `stripNullGuard` drops a guard on a
   different variable. Edit is correctly limited to `[DVT]`, but the delete confirmation for an
   untagged rule doesn't say it isn't app-made or that it also removes the rule's other actions (e.g. ASSIGN).
5. **Condition validation runs only for the first target of each bulk template** (`rules.ts:844-850`,
   `validate = targetIndex === 0`). If that target fails early, nothing else in the template is validated.
6. **Condition validation fails open** with no notice (`useValidationActions.ts:379-400`). Acceptable,
   since an invalid expression disables one rule rather than blocking entry, but the user should be warned.
7. **PRVs are created before the condition is validated** (`rules.ts:406-430, 515-542`). This leaves an unused
   PRV behind (reused next time).
8. **Any dataStore read error is treated as "no config"** (`useProgramConfig.ts:50-60, 89-105`). It fails
   safe, but hides 403/500 errors. A failed PUT then falls back to POST with a misleading "key exists" error.
9. **The PRV prefix isn't sanitised** (`rules.ts:119-121`). Spaces and reserved words cause server
   errors (surfaced, not corrupting).
10. **Edits touch only the first feedback action** of a rule that has several (`rules.ts:618-622`).
11. **Duplicate check ignores the interval amount** (`signature.ts:186`). "Within 60 days" is refused
    as a duplicate of "within 30 days".
12. **Test gaps:** no tests for `deleteRule`, partial create/update failure, batch errors, or the update
    payload. Rule tests assert condition strings, never what the condition means at the boundaries.

## Migration of rules already on live servers

Findings 1 and 2 affect rules that versions ≤ 1.0.2 have already written to production servers. After
the fix, the parser has to read `daysBetween(X, Y) <= 0` as "before". An existing rule with that
condition is _named_ "… must be on or before …" but behaves like "before". That is the behaviour the parser
will then report, so the app will show the stored rule's actual behaviour, but the name and message
won't match. Rules can't be told apart by condition alone. Options to decide on:

1. Accept the relabel and say so in the changelog. Admins re-save affected rules to fix the
   wording, or simply edit the message.
2. Tag rules written by the fixed version (e.g. `[DVT v2]` in the description). Rules without the tag that use a
   single date operator or `within` are listed as "created by an older version, check and re-save".
3. Offer an in-app repair that rewrites old rules to the condition matching their stored name.

Whichever is chosen, the release notes must tell admins that pre-1.0.3 single-operator date rules
and "within" rules don't do what their names say.

## What was checked and found correct

- Date **between**: guard `&& ( … || … )` is parenthesised, inclusive at both ends, parsed back in either order.
- Numeric single-value and **between** conditions: correctly negated and guarded with `d2:hasValue`.
- Relative bounds: `d2:addDays` only, sign correct. Fixed dates quoted `'YYYY-MM-DD'`.
- PRVs are only created/reused with `DATAELEMENT_CURRENT_EVENT` / `TEI_ATTRIBUTE`, matching the field id
  and source type, so a previous-event PRV is never reused. PRVs are **never deleted**, so deleting a rule
  can't break another rule that shares a PRV. Name conflicts (E4051) are handled.
- Editing (single and group) requires the `[DVT]` tag. `[DVT-BATCH]` is preserved. Submit buttons
  are disabled while saving. dataStore writes touch only the programme's own key.
- `DELETE /programRules/{id}` cascades to its actions. Rule names are unique (server returns 409). Both verified live.

## Claims investigated and rejected

- _"Server-side rule evaluation is unreliable on event programmes"_. Rules didn't fire on
  event-programme imports in a probe, even with condition `true`. This is a limitation of the import
  path used for testing, not an app defect. Firing was proven via tracked-entity enrollments
  instead. Client-side behaviour is covered by the Capture / Android pass.
