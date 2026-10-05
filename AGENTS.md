# Tracker Validation Tool - Agent Instructions

## Context

This is a DHIS2 web application to monitor and add program rules for validating date and numeric
input in tracker programmes. It is a **React app built on the DHIS2 App Platform**
(`@dhis2/cli-app-scripts`), written in TypeScript. It was migrated from a vanilla-JS webpack tool;
the pre-migration code lives in git history before the `feat/app-platform-migration` branch.

## Rules

- React 18 only — no Suspense-for-data-fetching, no React 19 APIs
- All UI comes from `@dhis2/ui`; custom components only when the library has no equivalent
- All DHIS2 API access goes through the app-runtime data engine (`useDataEngine`), wrapped in
  TanStack Query v4 hooks (`src/hooks/`) — never use raw `fetch` for DHIS2 endpoints
- Business logic (condition building/parsing, rule detection, signatures) lives in `src/lib/` as
  pure functions with unit tests next to them (`*.test.ts`) — keep it free of React and engine imports
- User-facing strings use `i18n.t()` from `@dhis2/d2-i18n`; strings persisted into DHIS2 metadata
  (rule names, conditions, descriptions) stay locale-independent English
- Styling: CSS Modules with DHIS2 design tokens (`var(--spacers-dp16)`, `var(--colors-grey900)`)
- Keep the dataStore namespace `tracker-date-validation` — existing installs depend on it
- Rules created by the app are tagged `[DVT]` (and `[DVT-BATCH]` for bulk-created rules) in the
  rule description; detection of "app-managed" rules relies on these tags

## Commands

- `pnpm start` — dev server (use `--proxy <url>` to proxy a DHIS2 instance)
- `pnpm run build` — production build + `.zip` bundle under `build/bundle/`
- `pnpm test` — vitest unit tests (`src/**/*.test.ts`, helpers in `src/test-utils/`)
- `pnpm run lint` — eslint + prettier check
- `pnpm exec tsc --noEmit` — type check

## Project Structure

```
d2.config.js            - DHIS2 App Platform config (entry, name, minDHIS2Version)
src/
  App.tsx               - Providers (QueryClient, CssReset/CssVariables) + hash router
  components/           - AppShell, ValidationForm, BatchWorkspace, RuleCard, modals
  pages/                - SelectProgramPage, OverviewPage, DetailsPage
  hooks/                - Data hooks (usePrograms, useProgramMetadata, useProgramConfig,
                          useProgramData) and mutation actions (useValidationActions)
  services/rules.ts     - Engine-based persistence: PRV conflict handling, rule create/update/
                          delete, batch apply
  test-utils/           - Unit-test helpers: fixtures, a fake DHIS2 server, the real rule engine
  lib/                  - Pure domain logic: builder, parser (strict condition reader), detector,
                          signature (app tags), variables, validation (form/preview/batch
                          helpers), types
```

## Architecture notes

- Routing is hash-based (`createHashRouter`) with the program in the path:
  `/:programId` (overview) and `/:programId/variable/:type/:id/:stageId?` (details)
- Program metadata (program + rules + PRVs + actions) is one TanStack Query cache entry keyed
  `['programMetadata', programId]`; all mutations invalidate it
- Mutation services take a _cloned_ metadata object and extend it with created objects so
  multi-rule runs (batch apply) reuse PRVs without refetching mid-run
- Per-program settings (rule/PRV name prefixes) live in the dataStore under
  `tracker-date-validation/config-<programId>`
