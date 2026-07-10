# DHIS2 Tracker Validator - Agent Instructions

## Context

This is a DHIS2 web application to monitor and add program rules for validating date and numeric input. It is a simple, vanilla JavaScript app that runs inside DHIS2 as an installed webapp. It is NOT a React app and does NOT use the DHIS2 App Platform.

## Rules

- Do NOT introduce React, Vue, or other frameworks — keep it vanilla JS with ES modules
- Do NOT replace the webpack build with Vite or other tools
- Do NOT hardcode DHIS2 URLs or credentials in source files — credentials go in `.env` (gitignored)
- All DHIS2 API calls MUST use the helpers in `src/js/d2api.js` — never use raw `fetch` or `XMLHttpRequest` for DHIS2 endpoints
- Always handle API errors — check for failures and surface meaningful messages to the user
- Preserve the `d2-manifest` post-build step that generates `manifest.webapp`
- Keep the app simple — these tools are for admin tasks, not end-user applications
- ESLint config: 4-space indent, double quotes, semicolons required

## Project Structure

```
src/
  app.js                  - Entry point, imports API helpers and CSS
  index.html              - Main HTML template with DHIS2 header bar div
  js/d2api.js             - DHIS2 API wrapper (d2Get, d2PostJson, d2PutJson, d2Delete, d2PostThenGet)
  js/check-header-bar.js  - Loads legacy header bar for DHIS2 < 2.42
  css/style.css           - App styles
  img/                    - Icons and images
  resources/              - Legacy DHIS2 header bar JS
```

## Architecture

- **Build system**: Webpack 5 with dev server proxy for DHIS2 authentication
- **No framework**: Plain JS with ES modules, direct DOM manipulation
- **API layer**: All DHIS2 API calls go through `src/js/d2api.js`
- **Styling**: Plain CSS in `src/css/`, loaded via webpack
- **DHIS2 integration**: Runs as installed app with relative API base path (`../../..`); dev mode uses proxy

## DHIS2 API

All DHIS2 API calls must use the wrapper functions in `src/js/d2api.js`:

- `d2Get("/api/endpoint")` — GET requests
- `d2PostJson("/api/endpoint", body)` — POST with JSON body
- `d2PutJson("/api/endpoint", body)` — PUT with JSON body (warns if no UID)
- `d2Delete("/api/endpoint")` — DELETE requests (warns if no UID)
- `d2PostThenGet(postUrl, body, getUrl)` — POST then poll a GET endpoint

The `formatEndpoint` helper normalizes paths, so `/api/foo`, `api/foo`, and `/foo` all resolve correctly.

## Build & Dev

- `yarn install` — install dependencies
- `yarn start` — start dev server on port 8081, proxying to DHIS2
- `yarn run build` — build to `build/` directory
- `yarn run zip` — build and zip for DHIS2 upload to `compiled/`
- `yarn run lint` — run ESLint

## Auth Configuration

Copy `.env.template` to `.env` and fill in the values. Supports two auth methods (token takes priority):

```
DHIS2_BASE_URL=http://localhost:8080/dhis
DHIS2_API_TOKEN=<your_token>        # Personal Access Token (DHIS2 2.38+, recommended)
DHIS2_USERNAME=<your_username>      # Basic Auth fallback
DHIS2_PASSWORD=<your_password>
```

## Scaffolding a New Tool

If creating a new app from this template (not modifying an existing one):

1. Update `name`, `description`, and `version` in `package.json`
2. Update the `manifest.webapp` section in `package.json` (app name, developer info)
3. Replace icon files in `src/img/icons/`
4. Add app logic in `src/app.js` and new modules in `src/js/`
5. Update `src/index.html` with the app's UI