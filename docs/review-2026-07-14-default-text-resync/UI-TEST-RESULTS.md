# UI Test Results — default-text re-sync on edit

**Date:** 2026-07-14
**Feature:** Re-sync a rule's name/description/validation message when its bound is edited, if (and only if) they are still the auto-generated defaults; preserve customized text.
**Instance:** disposable broker instance `agent-resync-42`, DHIS2 **2.42.5.1**, Sierra Leone demo seed (deleted after testing).
**How served:** App Platform dev server (`d2-app-scripts start --proxy … --proxyPort 8081`), driven with Playwright. Program: **Child Programme** (`IpHINAT79UW`), variable: **enrollment date**.

Each flow was driven through the real UI **and** the persisted `programRule` / `programRuleAction` were read back from the API as ground truth.

| #   | Flow                                                 | Steps                                                                                                                                       | Result   |
| --- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | Individual rule re-sync                              | Create date rule "after 1900-01-01" via the details form → Edit → change fixed date to 2000-01-01 → Save                                    | **PASS** |
| 2   | Bulk rule re-sync (headline scenario + HIGH-bug fix) | Create a bulk "after 1900-01-01" rule via BatchWorkspace (whole programme) → open one element's rule for edit → change to 2000-01-01 → Save | **PASS** |

## Flow 1 — individual (`[DVT]`)

- **After create** (API): name `Date of enrollment (enrollment date) must be after 1900-01-01`; description `[DVT] Validates that … after 1900-01-01`; condition `d2:daysBetween(V{enrollment_date}, '1900-01-01') > 0`; message matches name.
- **In the edit form**, after changing the bound to 2000, all three text fields re-synced live to `2000-01-01` (no `1900` remnant, no signature tag shown).
- **After update** (API): name/description/message/condition all `2000-01-01`; `[DVT]` tag preserved.

## Flow 2 — bulk (`[DVT] [DVT-BATCH]`) — verifies the HIGH bug fix

- **After bulk apply** (API): description `[DVT] [DVT-BATCH] Validates that … after 1900-01-01` (both tags present).
- **On opening the rule for edit**, the description field showed a **clean** `Validates that … after 1900-01-01` — **no `[DVT-BATCH]` tag leaked into the field** (this was the HIGH bug found in final review; now fixed). See `bulk-edit-resync.png`.
- **After changing the bound to 2000**, name/description/message all re-synced to `2000-01-01`, no tag leak in the fields.
- **After update** (API): description `[DVT] [DVT-BATCH] Validates that … after 2000-01-01` — **both tags preserved, body re-synced**; name/message/condition all `2000-01-01`; no `1900` anywhere.

## Console / network

No 5xx on `/api/*` during the flows. (One benign `404 /api/42/staticContent/logo_banner` from the app shell, unrelated.)

## Screenshots

- `individual-edit-resync.png` — individual rule edit form showing 2000 re-sync.
- `bulk-edit-resync.png` — bulk rule edit form: clean description (no `[DVT-BATCH]`), re-synced to 2000.
