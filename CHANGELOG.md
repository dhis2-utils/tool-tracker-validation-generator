# Changelog

All notable changes to this project will be documented in this file.

## 1.0.0 — 2026-08-25

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
