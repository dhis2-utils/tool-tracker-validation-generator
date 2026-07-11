# Tracker Validation Tool

DHIS2 admin tool for configuring validation of dates and numeric values in DHIS2 tracker
programmes, using program rules.

> **WARNING**
> This tool is intended to be used by system administrators to perform specific tasks; it is not
> intended for end users. It is available as a DHIS2 app, but has not been through the same
> rigorous testing as normal core apps. It should be used with care, and always tested in a
> development environment.

## What it does

- Lists all date and numeric variables in a tracker programme (enrollment/incident dates,
  tracked entity attributes, event/due dates, and stage data elements)
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

Requires DHIS2 2.41 or later.

## Development

```bash
pnpm install
pnpm start --proxy https://your-dhis2-instance   # dev server with auth proxy
pnpm test                                        # unit tests
pnpm run lint                                    # eslint + prettier
pnpm run build                                   # production build + zip bundle
```

The deployable app bundle is written to `build/bundle/tracker-validation-tool-<version>.zip` and
can be installed through the DHIS2 App Management app.
