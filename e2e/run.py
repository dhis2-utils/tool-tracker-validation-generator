#!/usr/bin/env python3
"""The e2e suite behind e2e/run.sh (see README.md and the TESTING.md contract).

Exit codes: 0 all tests passed, 1 a test failed, 2 the suite could not run.
"""
import json
import os
import sys
import time
import traceback
import uuid
import zipfile

START = time.time()
RESULTS_DIR = os.environ.get("RESULTS_DIR", "")
LABEL = os.environ.get("LABEL", "")


def write_results(payload):
    with open(os.path.join(RESULTS_DIR, "results.json"), "w") as fh:
        json.dump({"contract_version": 1, **payload, "duration_s": round(time.time() - START)}, fh, indent=2)


def fail_setup(stage, message, **known):
    print(f"e2e: {stage}: {message}", file=sys.stderr)
    if RESULTS_DIR and os.path.isdir(RESULTS_DIR):
        write_results({"label": LABEL, **known, "error": f"{stage}: {message}",
                       "total": 0, "passed": 0, "failed": 0, "skipped": 0, "tests": []})
    sys.exit(2)


if not RESULTS_DIR or not os.path.isdir(RESULTS_DIR):
    fail_setup("inputs", "RESULTS_DIR must be an existing directory")
for variable in ("DHIS2_URL", "DHIS2_USER", "DHIS2_PASS", "APP_ZIP"):
    if not os.environ.get(variable):
        fail_setup("inputs", f"{variable} is not set")

import common  # noqa: E402
from common import Results, SetupError, api, get  # noqa: E402


def manifest(app_zip):
    with zipfile.ZipFile(app_zip) as bundle:
        return json.loads(bundle.read("manifest.webapp"))


def upload(app_zip):
    """POST /api/apps, accepting any 2xx."""
    boundary = uuid.uuid4().hex
    with open(app_zip, "rb") as fh:
        content = fh.read()
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; "
            f"filename=\"{os.path.basename(app_zip)}\"\r\nContent-Type: application/zip\r\n\r\n").encode()
    body += content + f"\r\n--{boundary}--\r\n".encode()
    status, response = api("POST", "/apps", body, content_type=f"multipart/form-data; boundary={boundary}")
    if not 200 <= status < 300:
        raise SetupError(f"POST /api/apps: HTTP {status} {response}")


def installed_key(app_manifest):
    """The key the server gave the installed app (TESTING.md: not from d2.config.js)."""
    apps = [a for a in get("/apps") if a.get("name") == app_manifest["name"]]
    if len(apps) > 1:
        # e.g. the release before a key change is still installed under the same name
        apps = [a for a in apps if a.get("key") == app_manifest.get("short_name")
                and a.get("version") == app_manifest.get("version")]
    if len(apps) != 1:
        raise SetupError(f"{len(apps)} installed apps match {app_manifest['name']!r}")
    return apps[0]["key"]


def run_suites(results, state, app_url, shots_dir):
    from playwright.sync_api import sync_playwright

    import capture_web
    import tool_ui

    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--disable-dev-shm-usage"])
        try:
            rules_ok = tool_ui.run(browser, results, state, app_url, shots_dir)
            if rules_ok:
                capture_web.run(browser, results, state, shots_dir)
            else:
                results.add("capture-web", False, "not run: the matrix rules could not all be created")
        finally:
            browser.close()


def main():
    app_zip = os.environ["APP_ZIP"]
    if not os.path.isfile(app_zip):
        raise SetupError(f"APP_ZIP {app_zip} does not exist")
    server_version = get("/system/info")["version"]
    app_manifest = manifest(app_zip)
    known = {"label": LABEL or server_version, "server_version": server_version,
             "app_version": app_manifest.get("version")}
    results = Results(known["label"])
    shots_dir = os.path.join(RESULTS_DIR, "screenshots")
    os.makedirs(shots_dir, exist_ok=True)

    stage = "install"
    key = state = None
    try:
        upload(app_zip)
        key = app_manifest.get("short_name")  # what to uninstall if the lookup fails
        key = os.environ.get("APP_KEY") or installed_key(app_manifest)
        known["app_key"] = key
        stage = "seed"
        import seed
        leftovers = seed.remove_leftovers()
        if leftovers:
            raise SetupError(f"leftovers of an earlier run remain: {leftovers}")
        state = seed.setup()
        stage = "suite"
        run_suites(results, state, f"{common.BASE}/api/apps/{key}/index.html", shots_dir)
    except Exception as err:
        traceback.print_exc()
        cleanup(state, key, results)
        fail_setup(stage, f"{type(err).__name__}: {err}", **known)
    cleanup(state, key, results)
    write_results({**known, **results.tally(), "tests": results.tests})
    tally = results.tally()
    print(f"=== {known['label']}: {tally['passed']}/{tally['total']} passed, {tally['failed']} failed, "
          f"{tally['skipped']} skipped")
    return 0 if tally["failed"] == 0 else 1


def cleanup(state, key, results):
    """Remove the seeded metadata and uninstall the app, whatever happened before."""
    failed = []
    if state:
        import seed
        failed += seed.teardown(state)
    if key:
        status, _ = api("DELETE", f"/apps/{key}")
        if status not in (200, 204):
            failed.append(f"uninstall {key}: HTTP {status}")
    if state:
        results.add("cleanup", not failed, "; ".join(failed))
    elif failed:
        print(f"e2e: cleanup: {failed}", file=sys.stderr)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as err:  # before install: bad URL, credentials or bundle
        fail_setup("inputs", f"{type(err).__name__}: {err}")
