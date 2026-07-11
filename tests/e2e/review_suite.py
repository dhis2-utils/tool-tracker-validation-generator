#!/usr/bin/env python3
"""E2E review suite for the Tracker Validation Tool (DHIS2 App Platform build).

Drives the *installed* app on a DHIS2 instance (frame-aware: works both when
the app is served top-level (<=2.41) and inside the global-shell iframe
(2.42+)). Exercises the documented happy paths against the Sierra Leone demo
Child Programme and verifies every mutation through the API.

Usage:
    DHIS2_URL=http://dhis2-agent-review-41:8080 DHIS2_USER=local_admin \
    DHIS2_PASS=district LABEL=2.41 OUTDIR=docs/review-x python3 review_suite.py

All created objects are deleted at the end (API-level cleanup), regardless of
pass/fail. Exit code 0 = all steps passed.
"""
import base64
import json
import os
import sys
import time
import traceback
import urllib.request
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

BASE = os.environ.get("DHIS2_URL", "http://dhis2-agent-review-41:8080")
USER = os.environ.get("DHIS2_USER", "local_admin")
PASS = os.environ.get("DHIS2_PASS", "district")
LABEL = os.environ.get("LABEL", "dev")
OUTDIR = os.environ.get("OUTDIR", "/tmp/review")
APP_URL = f"{BASE}/api/apps/tracker-validation-tool/index.html"
PROGRAM = "Child Programme"
PROGRAM_ID = "IpHINAT79UW"

os.makedirs(OUTDIR, exist_ok=True)

results = []          # (step, PASS/FAIL, note)
console_errors = []
page_errors = []


def api(method, path, body=None):
    req = urllib.request.Request(
        f"{BASE}{path}",
        method=method,
        headers={
            "Authorization": "Basic "
            + base64.b64encode(f"{USER}:{PASS}".encode()).decode(),
            "Content-Type": "application/json",
        },
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
    req = urllib.request.Request(
        f"{BASE}/api/me",
        headers={"Authorization": "Basic "
                 + base64.b64encode(f"{USER}:{PASS}".encode()).decode()},
    )
    with urllib.request.urlopen(req) as r:
        for c in r.headers.get_all("Set-Cookie") or []:
            head = c.split(";", 1)[0]
            n, _, v = head.partition("=")
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
    """Return the page or frame that contains the app (global-shell aware)."""
    deadline = time.time() + 30
    while time.time() < deadline:
        for f in page.frames:
            try:
                if f.locator("[data-test='dhis2-uicore-singleselect']").count() > 0:
                    return f
            except Exception:
                pass
        page.wait_for_timeout(500)
    raise RuntimeError(f"app root not found; frames={[f.url for f in page.frames]}")


def choose(root, page, trigger_text, option_label):
    """Open the SingleSelect whose visible text contains trigger_text and pick an option."""
    sel = root.locator("[data-test='dhis2-uicore-singleselect']").filter(
        has_text=trigger_text).first
    sel.scroll_into_view_if_needed()
    sel.click()
    opt = root.locator("[data-test='dhis2-uicore-singleselectoption']").filter(
        has_text=option_label).first
    opt.click()
    page.wait_for_timeout(300)


def wait_alert(root, page, substr, timeout=30000):
    alert = root.locator("[data-test='dhis2-uicore-alertbar']").filter(
        has_text=substr).first
    alert.wait_for(state="visible", timeout=timeout)
    text = alert.inner_text()
    # dismiss/wait so the next assertion doesn't match a stale alert
    try:
        alert.wait_for(state="detached", timeout=12000)
    except Exception:
        pass
    return text


def fill_field(root, label, value):
    field = root.get_by_label(label, exact=False).first
    field.fill(value)


def shot(page, name):
    page.screenshot(path=os.path.join(OUTDIR, f"{LABEL}-{name}.png"), full_page=True)


def main():
    cn, cv = session_cookie()
    host = urlparse(BASE).hostname
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1400, "height": 950})
        ctx.add_cookies([{"name": cn, "value": cv, "domain": host, "path": "/"}])
        page = ctx.new_page()
        page.on("console", lambda m: console_errors.append(m.text)
                if m.type == "error" else None)
        page.on("pageerror", lambda e: page_errors.append(str(e)))

        # ---- 1. load ----
        page.goto(APP_URL, wait_until="domcontentloaded")
        root = find_root(page)
        try:
            root.get_by_text("Select a programme").first.wait_for(timeout=20000)
            record("app loads with empty state", True)
        except Exception as e:
            record("app loads with empty state", False, str(e))
        shot(page, "01-load")

        # ---- 2. select program ----
        try:
            choose(root, page, "Select a tracker programme", PROGRAM)
            root.get_by_text("Bulk rules for unvalidated variables").wait_for(timeout=30000)
            record("program selection loads overview", True)
        except Exception as e:
            record("program selection loads overview", False, str(e))
            shot(page, "02-overview-FAIL")
            raise

        # ---- 3. overview content ----
        try:
            root.get_by_text("Settings required").first.wait_for(timeout=10000)
            enr = root.get_by_text("Date of enrollment (enrollment date)")
            enr.first.wait_for(timeout=10000)
            birth_toggle = root.get_by_role("button", name="Birth").first
            birth_toggle.click()
            root.get_by_text("MCH Weight (g)").first.wait_for(timeout=5000)
            record("overview shows variables, stages expand, settings warning", True)
        except Exception as e:
            record("overview shows variables, stages expand, settings warning", False, str(e))
        shot(page, "03-overview")

        # ---- 4. settings ----
        try:
            root.get_by_role("button", name="Programme settings").click()
            modal = root.locator("[data-test='dhis2-uicore-modal']")
            modal.wait_for(timeout=10000)
            fill_field(modal, "Program rule name prefix", "TVT")
            fill_field(modal, "Program rule variable prefix", "TVT")
            modal.get_by_role("button", name="Save settings").click()
            wait_alert(root, page, "Settings saved")
            root.get_by_text("Settings required").first.wait_for(state="detached",
                                                                 timeout=10000)
            _, cfg = api("GET", "/api/dataStore/tracker-date-validation/"
                                f"config-{PROGRAM_ID}")
            ok = cfg == {"programRulePrefix": "TVT",
                         "programRuleVariablePrefix": "TVT"}
            record("settings saved to dataStore", ok, json.dumps(cfg))
        except Exception as e:
            record("settings saved to dataStore", False, str(e))
        shot(page, "04-settings")

        # ---- 5. create date rule (enrollment date on or before current date) ----
        try:
            root.get_by_text("Date of enrollment (enrollment date)").first.click()
            root.get_by_text("Add new validation").wait_for(timeout=10000)
            choose(root, page, "Choose relationship", "on or before")
            choose(root, page, "another tracked date", "the current date")
            preview = root.get_by_text(
                "Date of enrollment (enrollment date) should be on or before Current date")
            preview.wait_for(timeout=5000)
            shot(page, "05-date-form")
            root.get_by_role("button", name="Create validation rule").click()
            wait_alert(root, page, "created successfully")
            root.get_by_text("Rule ID").first.wait_for(timeout=15000)
            rules = app_rules()
            match = [r for r in rules
                     if "on or before" in r["name"] and "enrollment" in r["condition"]]
            cond_ok = match and match[0]["condition"] == \
                "d2:daysBetween(V{enrollment_date}, V{current_date}) <= 0"
            record("create date rule (UI + API condition)", bool(cond_ok),
                   match[0]["condition"] if match else "rule not found")
        except Exception as e:
            record("create date rule (UI + API condition)", False, str(e))
        shot(page, "05-date-rule")

        # ---- 6. edit rule -> SHOWWARNING ----
        try:
            root.get_by_role("button", name="Edit", exact=True).first.click()
            root.get_by_text("Edit program rule").wait_for(timeout=10000)
            choose(root, page, "Error — block save", "Warning — allow save")
            root.get_by_role("button", name="Update validation rule").click()
            wait_alert(root, page, "updated successfully")
            rules = app_rules()
            rid = rules[0]["id"]
            _, acts = api("GET", f"/api/programRuleActions.json?filter=programRule.id:eq:{rid}"
                                 "&fields=programRuleActionType&paging=false")
            types = [a["programRuleActionType"]
                     for a in (acts or {}).get("programRuleActions", [])]
            record("edit rule changes action type", types == ["SHOWWARNING"], str(types))
        except Exception as e:
            record("edit rule changes action type", False, str(e))
        shot(page, "06-edit")

        # ---- 7. numeric rule on MCH Weight (g) ----
        try:
            root.get_by_role("button", name="Back to overview").click()
            root.get_by_text("Bulk rules for unvalidated variables").wait_for(timeout=10000)
            root.get_by_role("button", name="Birth").first.click()
            root.get_by_text("MCH Weight (g)").first.click()
            root.get_by_text("Add new validation").wait_for(timeout=10000)
            choose(root, page, "Choose operator", "greater than")
            num = root.locator("input[type='number']").first
            num.fill("300")
            shot(page, "07-numeric-form")
            root.get_by_role("button", name="Create validation rule").click()
            wait_alert(root, page, "created successfully")
            rules = app_rules()
            match = [r for r in rules if "MCH Weight" in r["name"]]
            cond = match[0]["condition"] if match else ""
            ok = cond == "d2:hasValue(#{TVT_BIRTH_MCH_WEIGHT_G}) && #{TVT_BIRTH_MCH_WEIGHT_G} > 300"
            _, prvs = api("GET", f"/api/programRuleVariables.json?filter=program.id:eq:{PROGRAM_ID}"
                                 "&filter=name:eq:TVT_BIRTH_MCH_WEIGHT_G&fields=id,valueType&paging=false")
            prv_list = (prvs or {}).get("programRuleVariables", [])
            record("create numeric rule + prefixed PRV", ok and len(prv_list) == 1,
                   cond or "rule not found")
        except Exception as e:
            record("create numeric rule + prefixed PRV", False, str(e))
        shot(page, "07-numeric-rule")

        # ---- 8. batch apply (date before fixed 2030-01-01, whole programme) ----
        try:
            root.get_by_role("button", name="Back to overview").click()
            batch_card = root.locator("[data-test='dhis2-uicore-card']").filter(
                has_text="Bulk rules for unvalidated variables").first
            batch_card.wait_for(timeout=10000)
            choose(batch_card, page, "Choose relationship", "before")
            batch_card.locator("input[type='date']").fill("2030-01-01")
            batch_card.get_by_text(
                "Any unvalidated date should be before 2030-01-01").wait_for(timeout=5000)
            batch_card.get_by_role("button", name="Add to bulk queue").click()
            wait_alert(root, page, "added to the queue")
            batch_card.get_by_role("button", name="Apply queued rules").click()
            text = wait_alert(root, page, "validation rule", timeout=90000)
            batch = [r for r in app_rules() if "[DVT-BATCH]" in (r["description"] or "")]
            # unvalidated date vars: incident date + 2x event date + 2x due date = 5
            record("batch apply creates rules for unvalidated dates",
                   len(batch) == 5, f"batch rules={len(batch)}; alert={text!r}")
        except Exception as e:
            record("batch apply creates rules for unvalidated dates", False, str(e))
        shot(page, "08-batch")

        # ---- 9. specific rule triggers batch-cleanup offer ----
        try:
            root.get_by_text("Date of birth (incident date)").first.click()
            root.get_by_text("Add new validation").wait_for(timeout=10000)
            choose(root, page, "Choose relationship", "on or before")
            choose(root, page, "another tracked date", "the current date")
            root.get_by_role("button", name="Create validation rule").click()
            modal = root.locator("[data-test='dhis2-uicore-modal']").filter(
                has_text="Remove batch rules")
            modal.wait_for(timeout=30000)
            shot(page, "09-cleanup-offer")
            modal.get_by_role("button", name="Remove batch rules").click()
            wait_alert(root, page, "deleted successfully")
            batch_incident = [r for r in app_rules()
                              if "[DVT-BATCH]" in (r["description"] or "")
                              and "incident" in r["condition"]]
            record("batch-rule cleanup offer removes generic rule",
                   len(batch_incident) == 0, f"remaining={len(batch_incident)}")
        except Exception as e:
            record("batch-rule cleanup offer removes generic rule", False, str(e))
        shot(page, "09-cleanup")

        # ---- 10. delete a rule via UI ----
        try:
            before = len(app_rules())
            root.get_by_role("button", name="Delete", exact=True).first.click()
            modal = root.locator("[data-test='dhis2-uicore-modal']").filter(
                has_text="Delete validation rule")
            modal.wait_for(timeout=10000)
            modal.get_by_role("button", name="Delete", exact=True).click()
            wait_alert(root, page, "deleted successfully")
            after = len(app_rules())
            record("delete rule via UI", after == before - 1, f"{before}->{after}")
        except Exception as e:
            record("delete rule via UI", False, str(e))
        shot(page, "10-delete")

        # ---- 11. overview rule-count tags ----
        try:
            root.get_by_role("button", name="Back to overview").click()
            root.get_by_text("Bulk rules for unvalidated variables").wait_for(timeout=10000)
            tag = root.get_by_text("1 rule", exact=True).first
            tag.wait_for(timeout=10000)
            record("overview shows rule-count tags", True)
        except Exception as e:
            record("overview shows rule-count tags", False, str(e))
        shot(page, "11-final-overview")

        browser.close()


def cleanup():
    """Delete everything the suite created (rules, actions, PRVs, dataStore)."""
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
    api("DELETE", "/api/dataStore/tracker-date-validation/" f"config-{PROGRAM_ID}")
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

    print(f"\n=== {LABEL} results ===")
    for step, status, note in results:
        print(f"{status}: {step}" + (f" — {note}" if note else ""))
    benign = ("secure context", "logo_banner", "Failed to load resource")
    real_console = [e for e in console_errors if not any(b in e for b in benign)]
    print(f"console errors (non-benign): {len(real_console)}")
    for e in real_console[:10]:
        print("  ", e[:300])
    print(f"page errors: {len(page_errors)}")
    for e in page_errors[:10]:
        print("  ", e[:300])
    with open(os.path.join(OUTDIR, f"results-{LABEL}.json"), "w") as f:
        json.dump({"results": results, "console_errors": real_console,
                   "page_errors": page_errors}, f, indent=2)
    if failed or any(s == "FAIL" for _, s, _ in results) or real_console or page_errors:
        sys.exit(1)
