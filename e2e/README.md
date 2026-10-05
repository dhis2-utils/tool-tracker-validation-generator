# End-to-end suite

> [!WARNING]
> Run this suite on **disposable DHIS2 instances only**. It installs and uninstalls the app, and
> creates and deletes programmes, data elements, an organisation unit, a superuser and program
> rules. It cleans up after itself, but a run that is killed half-way leaves objects behind.

`e2e/run.sh` follows the e2e contract of
[reference-tool-conventions](https://github.com/dhis2-utils/reference-tool-conventions/blob/main/TESTING.md):

```bash
DHIS2_URL=http://dhis2-x:8080 DHIS2_USER=local_admin DHIS2_PASS=district \
APP_ZIP=$PWD/build/bundle/tool-tracker-validation-generator-1.1.0.zip RESULTS_DIR=/tmp/out \
  e2e/run.sh
```

| Variable                   | Required | Meaning                                                      |
| -------------------------- | -------- | ------------------------------------------------------------ |
| `DHIS2_URL`                | yes      | Instance base URL                                            |
| `DHIS2_USER`, `DHIS2_PASS` | yes      | A superuser (`local_admin` on the demo databases)            |
| `APP_ZIP`                  | yes      | The built bundle (`pnpm run build`)                          |
| `RESULTS_DIR`              | yes      | Existing directory for `results.json` and `screenshots/`     |
| `LABEL`                    | no       | Label for output and screenshots; default the server version |
| `APP_KEY`                  | no       | Default: the key the server gives the installed app          |

Exit code 0 means every test passed, 1 that a test failed, 2 that the suite could not run (the
`error` field in `results.json` says which stage). Needs Python 3 with Playwright's Chromium; the
suite does not depend on the demo database's own metadata.

## What it does

1. Installs `APP_ZIP` and finds its key in `/api/apps`.
2. Seeds its own metadata (`seed.py`), with names unique to the run: a tracker programme with
   one stage (dates A, B, C, numbers N, M) and a date attribute T, an event programme with a
   date E, a facility of their own and a test user with a random password, whose capture scope is
   that facility, so no other rule can interfere.
3. In the installed app (`tool_ui.py`): configures the programme settings, creates the rule
   matrix below through the form and checks each stored condition, edits two rules (action type;
   the message of a rule tied to no field, which takes the JSON-patch fallback on DHIS2 2.42),
   runs a bulk apply and its clean-up offer, deletes a rule, and covers the event programme.
4. In the Capture web app, as the test user (`capture_web.py`): enters every case in `cases.py`
   (dates relative to today) and checks that exactly the expected rule's message is shown, that
   an error blocks saving the person and completing the event, and that no other rule fires.
5. Deletes everything it seeded and uninstalls the app (test `cleanup`), then writes
   `results.json`.

| Rule | Validates                                      | Action             |
| ---- | ---------------------------------------------- | ------------------ |
| R1   | Date A on or before current date               | error              |
| R7   | Date A after 2000-01-01                        | error              |
| R2   | Date B within 7 days after Date A              | error              |
| R3   | Visit (event) date on or after enrollment date | error              |
| R4   | Number N between 35 and 42                     | error              |
| R5   | Number M less than Number N                    | warning (edited)   |
| R6   | Date T within 1 month before enrollment date   | error              |
| R8   | Enrollment date on or before current date      | error, edited text |

Before seeding, the suite records what it will create on the instance, at dataStore
`e2e-state/tool-tracker-validation-generator`, and every run first removes whatever that record
still lists. So a killed run's leftovers go with the next run, or by hand with
`python3 e2e/seed.py teardown`. The record is gone after a clean run.

## Capture web on DHIS2 < 2.42

Capture web evaluates rules with its legacy JavaScript engine on servers before 2.42 (the Kotlin
engine, shared with Android and the server, from 2.42). The legacy engine counts months
differently at month ends (31 Aug → 30 Sep is a whole month), so a "within N months/years" window
that ends on a month end rejects its last valid day there. `capture_web.py` detects the server
version and, for the R6 cases, expects the legacy engine's result on < 2.42.

## Android (manual)

The Android Capture app is not automated. Seed the metadata on its own and create the matrix
rules in the tool (table above):

```bash
DHIS2_URL=… DHIS2_USER=… DHIS2_PASS=… python3 e2e/seed.py setup
```

`setup` prints the test user and its password. Log in with them on the device (server URL as the
device sees it, e.g. `http://10.0.2.2:<port>` on the emulator) and enter the cases from
`cases.py`. To take screenshots, create the dataStore key `ANDROID_SETTING_APP/general_settings`
with `{"allowScreenCapture": true}` and delete it afterwards. Expect R3 and R8 to show nothing:
Android Capture does not show messages for rules on enrollment, incident, event or due dates
(ANDROAPP-7843); DHIS2 rejects such records when the device syncs. Finish with
`python3 e2e/seed.py teardown`.

## Other scripts

`manual_screenshots.py` regenerates the screenshots in `docs/MANUAL.md` against the Sierra Leone
demo database. It is not part of `run.sh`.
