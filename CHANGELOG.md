# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [1.1.0] - 2026-10-05

### Upgrading

- **The app key changes** from `tool-tracker-validation` to `tool-tracker-validation-generator`,
  the name of the repository. DHIS2 treats this as a different app:
    - Install the new version, then uninstall the old app in App Management, or two entries
      remain in the menu.
    - Add the new app to every user role that gave access to the old one. Until then, users
      without the ALL authority cannot open it.
    - Bookmarks to the old app URL stop working.

    The programme settings (rule and variable prefixes) are kept.

- **Delete and recreate the rules created by 1.0.2 or earlier.** Most of them do not behave as
  their names say (see Fixed), and the tool now lists them as "Not set up by this tool", read
  only. The rule logic review is in `docs/review-2026-10-02-rule-logic/`.

### Added

- A warning explains that the Android Capture app does not show rules on enrollment, incident,
  event or due dates (ANDROAPP-7843); the server rejects such records at sync.
- A warning is shown when DHIS2 could not be asked to validate a saved rule's condition (it used
  to pass silently).
- Rules listed under "Other program rules using this variable" are tagged "Set up by this tool"
  or "Not set up by this tool"; the tool's own rules link to the field they validate.
- An end-to-end suite, `e2e/run.sh`, for disposable instances: it creates a rule matrix through
  the installed app and checks every rule on its boundary days in the Capture web app.

### Changed

- Messages of rules on an enrollment, incident, event or due date name the date ("Visit (event)
  date must be on or after Enrollment date"), saying which date it is only when the programme
  gives it its own label: Capture lists these messages in its Error box, not next to a field.
- Bulk rules never target due dates (they are usually meant to be in the future).
- Rules created outside this tool are shown read-only, and deleting one warns that the whole rule
  goes, with every action it has. Rules with more than one message can only be edited in the
  Maintenance app.
- The program rule variable prefix is normalised to letters, digits and underscores.
- The generated conditions are verified in the unit tests against the DHIS2 rule engine itself
  (`@dhis2/rule-engine`, as used by Capture, Android and the server) on the boundary days and with
  empty fields. Unit tests sit next to the code they test.
- CI and release workflows follow the shared tool conventions: a tag that does not match
  `package.json` warns and still releases, a re-run uploads to the existing release, and the
  GitHub Actions are pinned to their current majors (`actions/checkout` v7.0.1,
  `pnpm/action-setup` v6.1.0, `actions/setup-node` v7.0.0, `actions/upload-artifact` v7.0.1).
- Tested on DHIS2 2.41.10, 2.42.6 and 2.43.1 with `e2e/run.sh`, and the rule matrix on the
  Android Capture app 3.4.2.
- README documents the Android limitations (on-complete actions on tracked entity attributes,
  rules on basic-info dates), event-programme support, and the post-rename bundle name.

### Fixed

- **"On or before" / "on or after" rejected the date itself, while "before" / "after" accepted
  it** — "must be on or before current date" blocked entering today's date. The four comparisons
  now mean exactly what they say.
- **"Within N … before/after" checked the opposite direction** and only one side. "Within 7 days
  before D" now accepts D minus 7 days up to D, both included, and rejects everything else.
  Weeks, months and years are exact (calendar months, clamped at month end) instead of counting
  only completed units.
- **Rules reading an enrollment, incident, event or due date** now check that it has a value.
  With the date empty (a scheduled event has no event date yet), Capture logged an engine error
  in the browser console on every evaluation.
- **Comparing two fields blocked entry while the second was empty** (an empty number counts as 0
  in the rule engine). Every field a rule reads is now guarded with `d2:hasValue`.
- **A range with minimum above maximum** (or a date range that is empty today), a zero or negative
  interval, and fractional offsets can no longer be saved — they would reject every value.
- **Editing a "within N days before" rule could silently disable it** (it re-saved comparing the
  field with itself). Conditions are now read back by a strict parser that only accepts the exact
  shapes the tool writes: re-saving can never change what a rule does, and rules written by hand
  are never mistaken for the tool's own.
- **The same data element in several stages** got the other stage's rules attributed to it, so
  removing redundant bulk rules could delete another stage's rule, and group edits renamed rules
  after the wrong stage.
- **A rule comparing a field with another date** was also listed (and editable) under that other
  date, where editing dropped the empty-field guard.
- **Event-date and due-date rules** could not be edited or duplicate-checked.
- **Saving a rule from a page loaded earlier deleted actions** other admins had added to it since.
  Updates now re-read the rule and refuse if it changed in the meantime.
- **Rules and their messages are saved in one atomic metadata import**, so a failure can no longer
  leave a rule without a message (invisible to the tool) or a new condition with an old message.
  Program rule variables created for a rule that is then refused are removed again. Deleting a
  rule deletes only the rule (DHIS2 removes its actions with it).
- Duplicate checks compare the exact condition (a different "within" interval is no longer a
  duplicate) and the full prefixed rule name, for numeric rules too.
- Group edits, "delete all" and the bulk-rule cleanup report one summary naming every rule that
  failed, instead of alerts that hide each other.
- Errors loading the programme settings are shown instead of being taken for "not configured".
- Editing a rule with a relative bound labelled it in years while the condition used days.
- Rule texts say "1 day", "1 month" instead of "1 days", "1 months".
- Editing a rule whose message is not tied to a field (e.g. an enrollment-date rule) failed with a
  server error on DHIS2 2.42: once a rule has been read, DHIS2 cannot update it and such a message
  in one metadata import (NullPointerException). The tool now falls back to patching the rule and
  then its message, restoring the rule if the second step fails.
- A rule name generated under a since-changed rule prefix is regenerated, not kept as
  "OLD - name".
- The standard DHIS2 tools **toolbox icon** is back in the app menu and App Management. The App
  Platform migration dropped the icon the vanilla tool shipped, so the app fell back to the
  platform's generic DHIS2 logo. It is now shipped as `public/dhis2-app-icon.png`, the filename
  the platform's generated `manifest.webapp` hard-codes.

### Security

- Dependencies updated for the open Dependabot advisories (`react-router-dom`, `@dhis2/ui`,
  `@dhis2/app-runtime`, `@dhis2/cli-app-scripts`, `vite`, `vitest`, and same-major overrides for
  `loader-utils`, `form-data` and `qs`); the production dependencies now audit clean.

## [1.0.2] - 2026-08-25

First published release. No functional changes since 1.0.0 — see that section
for what the release actually contains.

The `v1.0.0` and `v1.0.1` tags exist in the repository but never produced a
release: the release workflow extracted its notes from a `## [x.y.z]` changelog
heading, which `v1.0.0` did not have in that form and `v1.0.1` did not have at
all. Tags here are protected and cannot be moved, so the release was reissued
under a new version. The workflow no longer fails on a missing section.

## [1.0.0] - 2026-08-25

Verified end-to-end on DHIS2 **2.41.9.1, 2.42.5.2 and 2.43.1** against both the
Sierra Leone and Laos HMIS demo databases — 51 of 51 checks passing, no console
or page errors. See `docs/review-2026-08-24-multiversion/UI-TEST-RESULTS.md`.

### Added

- Numeric variable validation: create rules comparing a numeric value against a fixed value or
  another numeric field, alongside the existing date validations.
- Fixed / current / relative-date comparison targets in the rule builder and parser.
- Batch template workspace: queue reusable baseline templates and apply them in one pass to every
  variable that has no validation yet.
- `between` relationship for both date and numeric rules, in the details form and in the bulk
  template builder. Bounds are inclusive, and the generated texts say so.
- Support for **event programmes** (`WITHOUT_REGISTRATION`). Enrollment and incident dates are not
  offered there — DHIS2 creates one hidden enrollment per event, so a rule on `V{enrollment_date}`
  would fire on a date the user never sees. The programme picker labels event programmes.
- "Allow future dates" is surfaced per field, with a warning when a rule contradicts it: a field
  configured with `allowFutureDate = false` already rejects future values before any rule runs.
- A global rules view for reviewing and editing every rule in a programme in one place.
- User manual: `docs/MANUAL.md`.

### Changed

- Migrated from the vanilla-JS webpack tool to the DHIS2 App Platform (React 18 + TypeScript,
  `@dhis2/ui`, `@dhis2/app-runtime`, TanStack Query v4). The dataStore namespace
  (`tracker-date-validation`) is unchanged, so existing per-programme settings keep working.
- **App renamed to `tool-tracker-validation`** (was `tracker-validation-tool`). This changes the
  app's install key, so an instance carrying the old build sees this as a separate app; uninstall
  the old one after upgrading.
- Default rule texts are regenerated when a rule's bound is edited, and customised text is
  preserved. Name, description and validation message all come from one generator.
- Default-text wording: the stage is named only when the programme has more than one stage, and is
  spelled out in prose in the description; the validation message omits the field name for
  `SHOWERROR` / `SHOWWARNING` (which render next to the field) and keeps it for the on-complete
  actions (which render in a dialog).
- Relative date bounds are **days only**. `d2:addYears` / `d2:addMonths` were dropped: DHIS2 accepts
  them in a rule condition but does not evaluate them, so those rules silently never fired.
- CI replaced: a pnpm workflow (lint, typecheck, test, build) on every PR, and a tag-triggered
  release workflow that verifies the tag matches `package.json`.

### Fixed

- Numeric and `between` rules fired on the value being **valid** instead of on the violation, so
  they blocked correct data and allowed bad data.
- Bulk apply no longer creates future-rejecting rules for fields that explicitly allow future dates.
- Editing a bulk-created rule no longer leaks the internal batch tag into the description, and the
  description re-syncs correctly.
- The rule detector recognises `between` rules stored in the `||` outside-range form.
- Multi-version review fixes (DHIS2 2.41 / 2.42 / 2.43), including: `within_before` and `due_date`
  rules now detected and stage-scoped; `programRuleActions` fetched nested under program rules to
  work on 2.43; batch apply no longer creates a junk rule for the "current date" pseudo-variable;
  numeric rules gain a duplicate pre-check. See `docs/review-2026-07-10-app-platform-migration/`.
