#!/usr/bin/env python3
"""E2E suite for event-programme (WITHOUT_REGISTRATION) support.

Covers what the main review suite does not: that an event programme is
selectable at all, that enrollment/incident dates are *not* offered for it
(DHIS2 creates one hidden enrollment per event, so a rule on
V{enrollment_date} would fire on a date the user never sees), and that a rule
created on one of its date fields persists with the right condition.

Usage:
    DHIS2_URL=http://dhis2-agent-tv-43:8080 DHIS2_USER=local_admin \
    DHIS2_PASS=district LABEL=2.43 PROFILE=sl OUTDIR=docs/review-x \
    python3 event_program_suite.py

Everything created is deleted at the end regardless of pass/fail.
Exit code 0 = all steps passed.
"""
import base64
import json
import os
import re
import sys
import time
import traceback
import urllib.request
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

BASE = os.environ.get("DHIS2_URL", "http://dhis2-agent-tv-43:8080")
USER = os.environ.get("DHIS2_USER", "local_admin")
PASS = os.environ.get("DHIS2_PASS", "district")
LABEL = os.environ.get("LABEL", "dev")
OUTDIR = os.environ.get("OUTDIR", "/tmp/review")
APP_URL = f"{BASE}/api/apps/tool-tracker-validation/index.html"

SINGLESELECT = "[data-test='dhis2-uicore-singleselect']"
SINGLESELECTOPTION = "[data-test='dhis2-uicore-singleselectoption']"
ALERTBAR = "[data-test='dhis2-uicore-alertbar']"

# Event programmes are single-stage by nature, so the app should NOT append a
# stage suffix to the generated rule name.
PROFILES = {
    "sl": {
        "program": "Inpatient morbidity and mortality",
        "program_id": "eBAyeGv0exc",
        "stage": "Inpatient morbidity and mortality",
        "date_var": "Discharge Date",
    },
    "laos": {
        "program": "RMS - Rapid Mortality Surveillance",
        "program_id": "TP01C129Or9",
        "stage": "RMS - Rapid Mortality Surveillance",
        "date_var": "GEN - Date of death",
    },
}
PROFILE = PROFILES[os.environ.get("PROFILE", "sl")]
PROGRAM_ID = PROFILE["program_id"]

os.makedirs(OUTDIR, exist_ok=True)
results = []
console_errors = []
page_errors = []


def auth_header():
    return "Basic " + base64.b64encode(f"{USER}:{PASS}".encode()).decode()


def api(method, path, body=None):
    req = urllib.request.Request(
        f"{BASE}{path}",
        method=method,
        headers={"Authorization": auth_header(),
                 "Content-Type": "application/json"},
        data=json.dumps(body).encode() if body is not None else None,
    )
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read()
            return r.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, None


def session_cookie():
    req = urllib.request.Request(f"{BASE}/api/me",
                                 headers={"Authorization": auth_header()})
    with urllib.request.urlopen(req) as r:
        for c in r.headers.get_all("Set-Cookie") or []:
            n, _, v = c.split(";", 1)[0].partition("=")
            if "JSESSIONID" in n:
                return n.strip(), v.strip()
    raise RuntimeError("no JSESSIONID")


def record(step, ok, note=""):
    results.append((step, "PASS" if ok else "FAIL", note))
    print(f"[{LABEL}] {'PASS' if ok else 'FAIL'}: {step} {note}", flush=True)


def app_rules():
    _, data = api("GET", f"/api/programRules.json?filter=program.id:eq:{PROGRAM_ID}"
                         "&fields=id,name,description,condition&paging=false")
    return [r for r in (data or {}).get("programRules", [])
            if (r.get("description") or "").startswith("[DVT]")]


def find_root(page):
    deadline = time.time() + 30
    while time.time() < deadline:
        for f in page.frames:
            try:
                if f.locator(SINGLESELECT).count() > 0:
                    return f
            except Exception:
                pass
        page.wait_for_timeout(500)
    raise RuntimeError(f"app root not found; frames={[f.url for f in page.frames]}")


def choose(scope, page, trigger_text, option_label, root=None):
    root = root or scope
    sel = scope.locator(SINGLESELECT).filter(has_text=trigger_text).first
    sel.scroll_into_view_if_needed()
    sel.click()
    root.locator(SINGLESELECTOPTION).filter(
        has_text=re.compile(rf"^{re.escape(option_label)}$")).first.click()
    page.wait_for_timeout(300)


def wait_alert(root, substr, timeout=30000):
    alert = root.locator(ALERTBAR).filter(has_text=substr).first
    alert.wait_for(state="visible", timeout=timeout)
    text = alert.inner_text()
    try:
        alert.wait_for(state="detached", timeout=12000)
    except Exception:
        pass
    return text


def shot(page, name):
    page.screenshot(path=os.path.join(OUTDIR, f"{LABEL}-event-{name}.png"),
                    full_page=True)


def step_select_program(root, page):
    """The picker must offer the event programme, labelled as one."""
    try:
        choose(root, page, "Select a programme",
               f"{PROFILE['program']} (event programme)")
        root.get_by_text("Bulk rules for unvalidated variables").wait_for(
            timeout=30000)
        record("event programme is selectable and labelled", True)
    except Exception as e:
        record("event programme is selectable and labelled", False, str(e))
        raise


def step_settings(root):
    """Rule creation is blocked until the programme has prefixes configured,
    so set them the same way the main suite does."""
    try:
        root.get_by_role("button", name="Programme settings").click()
        modal = root.locator("[data-test='dhis2-uicore-modal']")
        modal.wait_for(timeout=10000)
        # @dhis2/ui InputField labels aren't associated with their inputs,
        # so address them by placeholder.
        modal.get_by_placeholder("e.g. EIR").nth(0).fill("TVT")
        modal.get_by_placeholder("e.g. EIR").nth(1).fill("TVT")
        modal.get_by_role("button", name="Save settings").click()
        wait_alert(root, "Settings saved")
        record("programme settings saved for the event programme", True)
    except Exception as e:
        record("programme settings saved for the event programme", False, str(e))
        raise


def step_no_enrollment_vars(root):
    """Enrollment and incident dates must not be offered."""
    try:
        body = root.locator("body").inner_text()
        offending = [t for t in ("(enrollment date)", "(incident date)")
                     if t in body]
        record("enrollment/incident dates are not offered", not offending,
               f"found={offending}" if offending else "")
    except Exception as e:
        record("enrollment/incident dates are not offered", False, str(e))


def step_event_date_offered(root):
    """The event date and the stage's date fields must be offered."""
    try:
        root.get_by_role("heading", name=PROFILE["stage"],
                         exact=True).first.click()
        root.get_by_text(PROFILE["date_var"]).first.wait_for(timeout=10000)
        record("stage date fields are offered", True)
    except Exception as e:
        record("stage date fields are offered", False, str(e))
        raise


def step_create_rule(root, page):
    """A rule on an event-programme date field persists with the right
    condition, and — single stage — carries no stage suffix in its name."""
    try:
        root.get_by_text(PROFILE["date_var"]).first.click()
        root.get_by_text("Add new validation").wait_for(timeout=10000)
        choose(root, page, "Choose relationship", "after")
        choose(root, page, "another tracked date", "a fixed date")
        root.locator("input[type='date']").first.fill("2000-01-01")
        shot(page, "form")
        root.get_by_role("button", name="Create validation rule").click()
        wait_alert(root, "created successfully")
        rules = app_rules()
        ok = len(rules) == 1 and " > 0" in rules[0]["condition"]
        note = rules[0]["condition"] if rules else "no rule created"
        record("create date rule on an event programme", ok, note)
    except Exception as e:
        record("create date rule on an event programme", False, str(e))
        return
    try:
        name = rules[0]["name"]
        # Single-stage programme: the stage adds nothing to disambiguate, so
        # the name must not carry a "(<stage>)" suffix.
        ok = PROFILE["stage"] not in name
        record("rule name omits the stage on a single-stage programme", ok, name)
    except Exception as e:
        record("rule name omits the stage on a single-stage programme",
               False, str(e))


def main():
    cn, cv = session_cookie()
    host = urlparse(BASE).hostname
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--disable-dev-shm-usage"])
        ctx = browser.new_context(viewport={"width": 1400, "height": 950})
        ctx.add_cookies([{"name": cn, "value": cv, "domain": host, "path": "/"}])
        page = ctx.new_page()
        page.on("console", lambda m: console_errors.append(m.text)
                if m.type == "error" else None)
        page.on("pageerror", lambda e: page_errors.append(str(e)))

        page.goto(APP_URL, wait_until="domcontentloaded")
        root = find_root(page)
        step_select_program(root, page)
        step_settings(root)
        step_no_enrollment_vars(root)
        shot(page, "overview")
        step_event_date_offered(root)
        step_create_rule(root, page)
        shot(page, "rule")
        browser.close()


def cleanup():
    deleted = {"rules": 0, "prvs": 0}
    for r in app_rules():
        _, acts = api("GET", f"/api/programRuleActions.json?filter=programRule.id:eq:{r['id']}"
                             "&fields=id&paging=false")
        for a in (acts or {}).get("programRuleActions", []):
            api("DELETE", f"/api/programRuleActions/{a['id']}")
        code, _ = api("DELETE", f"/api/programRules/{r['id']}")
        if code < 300:
            deleted["rules"] += 1
    _, prvs = api("GET", f"/api/programRuleVariables.json?filter=program.id:eq:{PROGRAM_ID}"
                         "&filter=name:like:TVT&fields=id&paging=false")
    for prv in (prvs or {}).get("programRuleVariables", []):
        code, _ = api("DELETE", f"/api/programRuleVariables/{prv['id']}")
        if code < 300:
            deleted["prvs"] += 1
    api("DELETE", f"/api/dataStore/tracker-date-validation/config-{PROGRAM_ID}")
    print(f"[{LABEL}] cleanup: {deleted}", flush=True)


if __name__ == "__main__":
    failed = False
    try:
        main()
    except Exception:
        traceback.print_exc()
        failed = True
    finally:
        cleanup()

    print(f"\n=== {LABEL} event-programme results ===")
    for step, status, note in results:
        print(f"{status}: {step}" + (f" — {note}" if note else ""))
    benign = ("secure context", "logo_banner", "Failed to load resource")
    real_console = [e for e in console_errors
                    if not any(b in e for b in benign)]
    print(f"console errors (non-benign): {len(real_console)}")
    for e in real_console[:10]:
        print("  ", e[:300])
    print(f"page errors: {len(page_errors)}")
    for e in page_errors[:10]:
        print("  ", e[:300])
    with open(os.path.join(OUTDIR, f"results-event-{LABEL}.json"), "w") as f:
        json.dump({"results": results, "console_errors": real_console,
                   "page_errors": page_errors}, f, indent=2)
    if failed or any(s == "FAIL" for _, s, _ in results) or real_console \
            or page_errors:
        sys.exit(1)
