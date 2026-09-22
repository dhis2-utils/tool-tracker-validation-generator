# Tracker Validation Tool

DHIS2 admin tool for configuring validation of dates and numeric values in DHIS2 tracker and
event programmes, using program rules.

> **WARNING**
> This tool is intended to be used by system administrators to perform specific tasks; it is not
> intended for end users. It is available as a DHIS2 app, but has not been through the same
> rigorous testing as normal core apps. It should be used with care, and always tested in a
> development environment.

## What it does

- Lists all date and numeric variables in a tracker or event programme (enrollment/incident
  dates, tracked entity attributes, event/due dates, and stage data elements)
- Shows which variables already have validation program rules — both rules created by this tool
  and other rules referencing the variable
- Creates validation rules through a guided form: compare a date against another tracked date,
  a fixed date, the current date, or a date relative to today; compare a numeric value against a
  fixed value or another numeric field
- Supports all feedback action types (`SHOWERROR`, `SHOWWARNING`, `ERRORONCOMPLETE`,
  `WARNINGONCOMPLETE`)
- Bulk rules: queue reusable baseline templates and apply them in one pass to every variable that
  has no validation yet; bulk rules are tagged so the tool can offer to remove them once a
  specific rule is created
- Edits and deletes rules created by the tool (tagged `[DVT]` in the rule description)
- Per-programme settings for program rule and program rule variable name prefixes (stored in the
  DHIS2 dataStore)

## Tech stack

- [DHIS2 App Platform](https://developers.dhis2.org/docs/app-platform/getting-started)
  (`@dhis2/cli-app-scripts`), TypeScript, React 18
- `@dhis2/ui` components, `@dhis2/app-runtime` data engine
- TanStack Query v4 for caching, React Router (hash router)
- Vitest for unit tests of the pure rule-expression logic

Requires DHIS2 2.41 or later. Verified end-to-end on 2.41, 2.42 and 2.43 against the Sierra
Leone and Laos HMIS demo databases — see `docs/review-2026-08-24-multiversion/`.

## Documentation

- [User manual](docs/MANUAL.md) — walkthrough with screenshots, including how the rules appear
  in the Metadata Management app and when entering data in Capture
- [Changelog](CHANGELOG.md)

## Known limitations

- **Android: on-complete actions on tracked entity attributes do nothing.** The DHIS2 Android
  Capture app does not support `ERRORONCOMPLETE` / `WARNINGONCOMPLETE` for tracked entity
  attributes (they are supported for data elements). A rule of that shape shows nothing on
  Android — use `SHOWERROR` / `SHOWWARNING` for attribute rules where Android is in use. The tool
  does not yet warn about this combination.
- **`WARNINGONCOMPLETE` repeats the field name.** DHIS2 itself prefixes on-complete warnings with
  the data element name, and the tool's default message also includes it, so the name appears
  twice. Kept deliberately for consistency with `ERRORONCOMPLETE`, which is not prefixed.
- **Relative date bounds are in days only.** DHIS2 accepts `d2:addMonths` / `d2:addYears` in a
  rule condition but does not evaluate them, so such rules would silently never fire.
- **Fields that already reject future dates** (`allowFutureDate = false`) are validated by DHIS2
  before any rule runs; the tool warns when a rule contradicts the field's own setting.
- Numeric fields bound to an option set are not offered — the option set already constrains them.

## Development

```bash
pnpm install
pnpm start --proxy https://your-dhis2-instance   # dev server with auth proxy
pnpm test                                        # unit tests
pnpm run lint                                    # eslint + prettier
pnpm run build                                   # production build + zip bundle
```

The deployable app bundle is written to `build/bundle/tool-tracker-validation-<version>.zip` and
can be installed through the DHIS2 App Management app. Tagged releases (`v*.*.*`) also attach
it to a GitHub release via `.github/workflows/release.yml`.
