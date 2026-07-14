# State Changes — 2026-07-14 live verification

All persistent changes were made against a disposable broker instance that was **deleted** at the end, so nothing outlives this session.

| Change                                                                         | Where       | Reverted?                                          |
| ------------------------------------------------------------------------------ | ----------- | -------------------------------------------------- |
| Created broker instance `agent-resync-42` (DHIS2 2.42.5.1, SL demo seed)       | broker host | **Deleted** (job `j-f4efed98`, 0 instances remain) |
| Created empty broker instance `agent-resync-e` (abandoned mid-diagnosis)       | broker host | **Deleted**                                        |
| Added `http://localhost:49244` to `/api/configuration/corsWhitelist`           | instance    | Gone with the instance                             |
| Seeded dataStore key `tracker-date-validation/config-IpHINAT79UW` (PRV prefix) | instance    | Gone with the instance                             |
| Created program rules (individual + bulk date rules) during the drive          | instance    | Gone with the instance                             |

No changes were made to any user-supplied instance (none was used). No repo source files were modified by the live verification (only report artifacts under `docs/review-2026-07-14-default-text-resync/`).
