# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

### Added

- Numeric variable validation: create rules comparing a numeric value against a fixed value or
  another numeric field, alongside the existing date validations.
- Fixed / current / relative-date comparison targets in the rule builder and parser.
- Batch template workspace: queue reusable baseline templates and apply them in one pass to every
  variable that has no validation yet.

### Changed

- Migrated from the vanilla-JS webpack tool to the DHIS2 App Platform (React 18 + TypeScript,
  `@dhis2/ui`, `@dhis2/app-runtime`, TanStack Query v4). The dataStore namespace
  (`tracker-date-validation`) is unchanged, so existing per-programme settings keep working.

### Fixed

- Multi-version review fixes (DHIS2 2.41 / 2.42 / 2.43), including: `within_before` and `due_date`
  rules now detected and stage-scoped; `programRuleActions` fetched nested under program rules to
  work on 2.43; batch apply no longer creates a junk rule for the "current date" pseudo-variable;
  numeric rules gain a duplicate pre-check. See `docs/review-2026-07-10-app-platform-migration/`.
