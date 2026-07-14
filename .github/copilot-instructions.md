# Copilot / AI Assistant Instructions

## Project Overview

This is a DHIS2 admin web app for configuring **validation program rules** for both **date and
numeric** variables in tracker programmes. It gives system administrators a guided interface to
create, edit, and delete validation rules (e.g. "date X must be before date Y", "value must be

> = 0") without hand-authoring program rules, program rule variables, and rule actions.

It is a **React app built on the DHIS2 App Platform** (`@dhis2/cli-app-scripts`), written in
TypeScript. It was migrated from a vanilla-JS webpack tool; the pre-migration code lives in git
history before the `feat/app-platform-migration` branch. Ignore any older guidance describing a
`src/app.js` webpack entry, `d2api.js`, `d2auth.json`, or materialize-css — none of that applies
anymore.

## Tech stack

- DHIS2 App Platform (`@dhis2/cli-app-scripts`), TypeScript, React 18
- `@dhis2/ui` components; `@dhis2/app-runtime` data engine
- TanStack Query v4 for caching; React Router (hash router)
- Vitest for unit tests of the pure rule-expression logic
- pnpm for dependencies; supports DHIS2 2.41+

## Rules / conventions

- React 18 only — no Suspense-for-data-fetching, no React 19 APIs
- All UI comes from `@dhis2/ui`; add custom components only when the library has no equivalent
- All DHIS2 API access goes through the app-runtime data engine (`useDataEngine`), wrapped in
  TanStack Query v4 hooks (`src/hooks/`) — never use raw `fetch` for DHIS2 endpoints
- Business logic (condition building/parsing, rule detection, signatures, variable derivation,
  form/preview/batch helpers) lives in `src/lib/` as pure functions with unit tests in `tests/` —
  keep it free of React and engine imports
- Date validations use `operator` + comparison fields; numeric validations use `numericOperator`
    - `numericComparisonType` ('value' | 'field'). Keep both paths in sync when adding features
- User-facing strings use `i18n.t()` from `@dhis2/d2-i18n`; strings persisted into DHIS2 metadata
  (rule names, conditions, descriptions) stay locale-independent English
- Styling: CSS Modules with DHIS2 design tokens (`var(--spacers-dp16)`, `var(--colors-grey900)`)
- Keep the dataStore namespace `tracker-date-validation` — existing installs depend on it (the
  namespace name is historical; it stores config for both date and numeric rules)
- Rules created by the app are tagged `[DVT]` (and `[DVT-BATCH]` for bulk-created rules) in the
  rule description; detection of "app-managed" rules relies on these tags

## Commands

```bash
pnpm install                              # install dependencies
pnpm start --proxy https://<instance>     # dev server with auth proxy
pnpm test                                 # vitest unit tests
pnpm run lint                             # eslint + prettier
pnpm run build                            # production build + zip bundle
pnpm exec tsc --noEmit                    # type check
```

## Project structure

```
d2.config.js            - App Platform config (entry, name, minDHIS2Version)
src/
  App.tsx               - Providers (QueryClient, CssReset/CssVariables) + hash router
  components/           - AppShell, ValidationForm, BatchWorkspace, RuleCard, modals
  pages/                - SelectProgramPage, OverviewPage, DetailsPage
  hooks/                - Data hooks (usePrograms, useProgramMetadata, useProgramConfig,
                          useProgramData) and mutation actions (useValidationActions)
  services/rules.ts     - Engine-based persistence: PRV conflict handling, rule create/update/
                          delete (date + numeric), batch apply
  lib/                  - Pure domain logic: builder, detector, signature (condition parser),
                          variables, validation (form/preview/batch helpers), types
tests/                  - Vitest unit tests for src/lib and src/services
```
