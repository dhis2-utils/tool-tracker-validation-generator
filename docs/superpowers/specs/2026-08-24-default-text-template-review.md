# Default-text template review: name, description, validation message

**Date:** 2026-08-24
**Status:** Implemented (see "Implementation" at the end)
**Supersedes wording decisions in:** `2026-07-14-default-text-resync-design.md`
(that spec unified _where_ default text comes from; this one settles _what it says_)

## Scope note

DHIS2 `programRule` has **no `shortName` field**. The three generated texts are:

| Text                   | Stored on                   | Seen by                     |
| ---------------------- | --------------------------- | --------------------------- |
| **name**               | `programRule.name`          | admins, metadata exports    |
| **description**        | `programRule.description`   | admins, metadata exports    |
| **validation message** | `programRuleAction.content` | data-entry users in Capture |

All three are produced by `getValidationPreview` in `src/lib/validation.ts`.

## 1. Rule name

**Decision: add the missing `must be` to the `within_before` / `within_after`
variant.** Every other variant already reads `<field> must be <condition>`; the
interval variant was the odd one out.

```
- `${variableDisplayName} within ${interval} ${dir} ${comparisonName}`
+ `${variableDisplayName} must be within ${interval} ${dir} ${comparisonName}`
```

    before: Visit date (Follow-up) within 30 days after Enrollment date
    after:  Visit date (Follow-up) must be within 30 days after Enrollment date

**Decision: suppress the stage suffix when the programme has only one stage.**
Currently `getVariableDisplayName` appends `(Stage name)` unconditionally for
`dataElement`, `event_date` and `due_date`. On a single-stage programme there is
nothing to disambiguate against, so the suffix is pure noise. `programStages` is
already fetched (`useProgramMetadata.ts:22`), so the count is available —
`getVariableDisplayName` needs the stage count (or a precomputed flag) passed in.

    multi-stage:  Date of birth (Birth details) must be after 2000-01-01
    single-stage: Date of birth must be after 2000-01-01

### Doubled parentheticals on the synthetic date variables

`buildVariablesArray` bakes a type marker into the name of the variables it
synthesises — `"Report date (event date)"`, `"Registration date (enrollment
date)"` — so appending the stage produced two parentheticals in a row:

    before: Report date (event date) (Specimen Tracking) must be after …
    after:  Report date (Specimen Tracking event date) must be after …

**Decision: fold the stage into the marker we appended ourselves.** Inferring
the marker by matching a trailing `(…)` is not safe — real metadata contains
data elements named `Weight (kg)` and `Age (years)`, which must keep their own
parenthetical and take the stage separately (`Weight (kg) (Specimen Tracking)`).
So `Variable` carries an explicit `typeLabel` field, set only where this app
composes the name, and the fold happens only when the name ends with exactly
that marker.

## 2. Description

**Decision: include the stage name, spelled out as prose** — the description has
the most room, so it is the right place to be explicit. Omitted when the
programme has a single stage (same rule as the name) and for variables that have
no stage at all (enrollment date, incident date, tracked entity attributes).

    multi-stage:   [DVT] Validates that Date of birth in the Birth details stage
                   is after 2000-01-01
    single-stage:  [DVT] Validates that Date of birth is after 2000-01-01
    non-stage var: [DVT] Validates that Date of enrollment is after 2000-01-01

Rejected: the parenthetical `(Birth details)` form (terser, but reads as a
code-ish suffix where prose fits), and including the programme name (redundant —
a rule only ever exists within one programme).

**Decision: drop `is entered` and unify the inclusive wording to `(inclusive)`.**
Two inconsistencies removed:

- `is entered` appeared only on the `before` / `after` variants; every other
  variant used a plain `is`. Now all read `Validates that <field> is …`.
- `between` said `, both included` where the name and message say `(inclusive)`.
  All three texts now agree.

<!-- prettier-ignore -->
```
- Validates that X is entered after 2000-01-01
+ Validates that X is after 2000-01-01
- Validates that X is between A and B, both included
+ Validates that X is between A and B (inclusive)
```

Applies to both the date and numeric `between` variants.

## 3. Validation message

**Decision: omit the field name for `SHOWERROR` / `SHOWWARNING`; include it for
`ERRORONCOMPLETE` / `WARNINGONCOMPLETE`.** The message text therefore depends on
the configured action type.

Rationale, from the `programRuleAction` model docs:

| Action type         | Where it renders                            | Field name |
| ------------------- | ------------------------------------------- | ---------- |
| `SHOWERROR`         | linked to the element — next to the field   | redundant  |
| `SHOWWARNING`       | displayed next to the data element          | redundant  |
| `ERRORONCOMPLETE`   | modal on complete; only _linked_ to element | needed     |
| `WARNINGONCOMPLETE` | prefixed by DHIS2 with the element name     | needed\*   |

\* **Accepted duplication.** DHIS2 prefixes `WARNINGONCOMPLETE` messages with the
data element's name/formName itself, so including our own field name doubles it
up (`Date of birth: Date of birth must be after 2000-01-01`). The maintainer
chose to include it anyway for consistency with `ERRORONCOMPLETE`, until that is
fixed upstream. Do **not** "fix" this by branching the two on-complete types
apart without checking back.

    SHOWERROR / SHOWWARNING:  Must be after 2000-01-01
    *ONCOMPLETE:              Date of birth must be after 2000-01-01

Open detail for implementation: the field-less form starts a sentence, so it
should be capitalised (`Must be …`, not `must be …`).

### Implementation trap: re-sync must use the _stored_ action type

`buildEditConfig` decides a text is "customized" by comparing the stored string
against the freshly generated suggestion. Now that the message depends on the
action type, that comparison **must** generate its suggestion using the rule's
stored action type — otherwise every existing rule whose action type differs
from the default will look customized and stop re-syncing.

Consequence to accept: changing the action type in the edit form re-generates the
message (for rules whose message is still the default). That is coherent, but it
means the default text now depends on two fields rather than one.

## Findings surfaced during the review (not template changes)

1. **The programme filter excluded event programmes for no apparent reason.**
   _Resolved — support added, see "Event programme support" below._
   `usePrograms.ts:19` filters `programType:eq:WITH_REGISTRATION`. The Android
   docs list all four feedback action types as fully supported for "Program
   without registration", and `buildVariablesArray` already degrades correctly:
   the four event programmes in the Laos demo have one stage each and no
   `enrollmentDateLabel`, so only event date, due date and data-element variables
   would be produced — exactly right. The single-stage suppression decided above
   also covers event programmes for free, since they always have exactly one
   stage.

2. **On-complete actions are not supported for tracked entity attributes on
   Android.** The Android support matrix marks `WARNINGONCOMPLETE` and
   `ERRORONCOMPLETE` N/A for tracked entity attributes (even with registration).
   A rule on a TEI attribute with an on-complete action silently shows nothing in
   the Android app. The app currently offers that combination without warning —
   candidate for the same contradiction-warning treatment as `allowFutureDate`.

## Implementation

All of the above landed in `src/lib/validation.ts`, `src/lib/variables.ts` and
`src/lib/types.ts`, test-first. Notes on how:

- **Stage count is derived, not threaded.** `getValidationPreview` already
  receives the full `variables` array, and `buildVariablesArray` emits an
  event-date variable per stage, so `countStages` counts distinct `stageId`s
  rather than adding a parameter to every call site. `getVariableDisplayName`
  takes an optional `stageCount`; omitted means "unknown" and keeps the stage,
  since dropping it can make names collide.
- **The action type is already in `ValidationConfig`**, so the message needed no
  new parameter either — `messageLead` reads `config.actionType`, defaulting to
  `SHOWERROR`.
- Two tests in `buildEditConfig` cover the re-sync trap directly, and were
  confirmed to fail when the action type is not threaded into the suggestion.
- One superseded test was removed (`adds stage context to the name only, not the
message`); the `default-text templates` suite covers both behaviours in
  detail. The bulk stage-aware-name test in `services-rules.test.ts` gained a
  second stage in its fixture, so it still tests stage-aware naming rather than
  being weakened to match the new single-stage output.

Not done, still open: warning about on-complete actions on TEI attributes
(finding 2 above).

## Event programme support

`usePrograms` no longer filters on `programType`, so programmes without
registration are selectable; the picker labels them "(event programme)" so the
two kinds are distinguishable. `programType` is now fetched in both the list and
the metadata query.

`buildVariablesArray` skips the **enrollment and incident date** variables for a
`WITHOUT_REGISTRATION` programme even when the programme carries labels for
them: DHIS2 creates one hidden enrollment per event there, so a rule on
`V{enrollment_date}` would fire on a date the user never sees. Event date, due
date and stage data elements are offered as usual. An absent `programType` is
treated as a tracker programme, so a metadata query that omits the field can
never silently drop variables.

**Verified live** on the Laos demo (DHIS2 2.42.5.2) by walking the app's own
metadata path against the "RMS - Rapid Mortality Surveillance" event programme:
a `DATAELEMENT_CURRENT_EVENT` program rule variable, a `d2:daysBetween` rule
condition (validated through `/api/programRules/condition/description` — "Valid"),
a `programRule`, and a `SHOWERROR` action bound to the data element all created
with 201, and read back correctly through the nested
`programRules?fields=:owner,programRuleActions[:owner]` query the app uses. Test
metadata was deleted afterwards.

Copy that promised tracker-only was corrected in `AppShell` and
`SelectProgramPage`. The app's own name ("Tracker Validation Tool") was left
alone — renaming it is a separate decision, since it is also the DHIS2 app name.
