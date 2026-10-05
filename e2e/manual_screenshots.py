#!/usr/bin/env python3
"""Capture the screenshots used in docs/MANUAL.md.

Drives the installed app on a DHIS2 instance to build a small, realistic set
of rules, screenshotting each step, then shows the same rules as DHIS2 itself
sees them: in the Metadata Management app and firing in Capture during data
entry.

Rules are left in place on the instance so the screenshots stay reproducible;
pass CLEANUP=1 to delete them afterwards.

Usage:
    DHIS2_URL=http://dhis2-x:8080 DHIS2_USER=local_admin \
    DHIS2_PASS=district OUTDIR=docs/manual-screenshots \
    python3 manual_screenshots.py
"""
import base64
import json
import os
import re
import socket
import sys
import threading
import time
import traceback
import urllib.request
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

BASE = os.environ["DHIS2_URL"]  # a disposable instance; no defaults
USER = os.environ["DHIS2_USER"]
PASS = os.environ["DHIS2_PASS"]
OUTDIR = os.environ.get("OUTDIR", "docs/manual-screenshots")
CLEANUP = os.environ.get("CLEANUP") == "1"

_p = urlparse(BASE)
REMOTE_HOST = _p.hostname
REMOTE_PORT = _p.port or 80

# Capture's App-Platform build refuses to load unless the page is a secure
# context, and plain http://<host>:<port> is not one — but localhost always is.
# An in-process TCP forwarder gives the browser a localhost origin; nothing is
# exposed outside the sandbox. Everything (app, Metadata Management, Capture)
# is driven through it so there is a single origin.
LBASE = None
EVENT_ORG_UNIT = os.environ.get("EVENT_ORG_UNIT", "y77LiPqLMoq")  # Gbenikoro MCHP

SINGLESELECT = "[data-test='dhis2-uicore-singleselect']"
SINGLESELECTOPTION = "[data-test='dhis2-uicore-singleselectoption']"
ALERTBAR = "[data-test='dhis2-uicore-alertbar']"
MODAL = "[data-test='dhis2-uicore-modal']"

TRACKER_PROGRAM = "Child Programme"
TRACKER_PROGRAM_ID = "IpHINAT79UW"
EVENT_PROGRAM = "Inpatient morbidity and mortality"
EVENT_PROGRAM_ID = "eBAyeGv0exc"
EVENT_STAGE = "Inpatient morbidity and mortality"
EVENT_DATE_FIELD = "Discharge Date"
# Capture renders the data element's *form name*, which differs from the
# metadata name the tool shows.
CAPTURE_DATE_LABEL = os.environ.get("CAPTURE_DATE_LABEL", "Date of discharge")
MM_SEARCH_PLACEHOLDER = "Search by name, code or ID"
# Entering a date before this bound in Capture must trip the rule.
EVENT_BOUND = "2020-01-01"

# For the Capture screenshots, a rule on a DATE *attribute* of a tracker
# programme: the registration form renders the field directly, with no
# mandatory option-set fields to satisfy first.
CAPTURE_PROGRAM = "MNCH / PNC (Adult Woman)"
CAPTURE_PROGRAM_ID = "uy2gU8kT1jF"
CAPTURE_ATTR = "Date of birth"
CAPTURE_ORG_UNIT = os.environ.get("CAPTURE_ORG_UNIT", "y77LiPqLMoq")
# A *past* date that breaks our rule. A future date would be rejected by
# DHIS2's own allowFutureDate check on the attribute before the rule engine
# ever sees the value — which is exactly what the app's "allow future dates"
# warning is about.
CAPTURE_BOUND = "2000-01-01"
CAPTURE_VIOLATION_DATE = "1990-05-20"

os.makedirs(OUTDIR, exist_ok=True)
shots = []


def _pipe(a, b):
    try:
        while (chunk := a.recv(65536)):
            b.sendall(chunk)
    except OSError:
        pass
    finally:
        for sock in (a, b):
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass


def start_forwarder():
    srv = socket.socket()
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("127.0.0.1", 0))
    lport = srv.getsockname()[1]
    srv.listen()

    def loop():
        while True:
            try:
                client, _ = srv.accept()
                up = socket.create_connection((REMOTE_HOST, REMOTE_PORT))
            except OSError:
                continue
            threading.Thread(target=_pipe, args=(client, up), daemon=True).start()
            threading.Thread(target=_pipe, args=(up, client), daemon=True).start()

    threading.Thread(target=loop, daemon=True).start()
    return lport


def auth_header():
    return "Basic " + base64.b64encode(f"{USER}:{PASS}".encode()).decode()


def api(method, path, body=None):
    req = urllib.request.Request(
        f"{BASE}{path}", method=method,
        headers={"Authorization": auth_header(),
                 "Content-Type": "application/json"},
        data=json.dumps(body).encode() if body is not None else None)
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


def find_root(page):
    deadline = time.time() + 90
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


def wait_alert(root, substr, timeout=60000):
    alert = root.locator(ALERTBAR).filter(has_text=substr).first
    alert.wait_for(state="visible", timeout=timeout)
    text = alert.inner_text()
    try:
        alert.wait_for(state="detached", timeout=12000)
    except Exception:
        pass
    return text


def shot(page, name, full=False):
    path = os.path.join(OUTDIR, f"{name}.png")
    # animations="disabled" matters on the older Struts-era apps, whose
    # spinners never let the page reach the stable state a screenshot waits
    # for — without it the call just times out.
    page.screenshot(path=path, full_page=full, animations="disabled",
                    timeout=60000)
    shots.append(name)
    print(f"  shot: {name}.png", flush=True)


def configure_settings(root, page):
    root.get_by_role("button", name="Programme settings").click()
    modal = root.locator(MODAL)
    modal.wait_for(timeout=10000)
    modal.get_by_placeholder("e.g. EIR").nth(0).fill("TVT")
    modal.get_by_placeholder("e.g. EIR").nth(1).fill("TVT")
    shot(page, "03-settings")
    modal.get_by_role("button", name="Save settings").click()
    wait_alert(root, "Settings saved")


def tracker_flow(root, page):
    """Overview, settings, a date rule and a numeric rule on Child Programme."""
    choose(root, page, "Select a programme", TRACKER_PROGRAM)
    root.get_by_text("Bulk rules for unvalidated variables").wait_for(timeout=30000)
    shot(page, "02-overview")
    configure_settings(root, page)

    # A date rule: enrollment date must be on or before today
    root.get_by_text("Date of enrollment (enrollment date)").first.click()
    root.get_by_text("Add new validation").wait_for(timeout=10000)
    choose(root, page, "Choose relationship", "on or before")
    choose(root, page, "another tracked date", "the current date")
    root.get_by_text(
        "Date of enrollment (enrollment date) should be on or before Current date"
    ).wait_for(timeout=5000)
    shot(page, "04-date-rule-form")
    root.get_by_role("button", name="Create validation rule").click()
    wait_alert(root, "created successfully")
    root.get_by_text("Rule ID").first.wait_for(timeout=15000)
    shot(page, "05-rule-created")

    # A numeric rule: MCH Weight (g) must be greater than 500
    root.get_by_role("button", name="Back to overview").click()
    root.get_by_text("Bulk rules for unvalidated variables").wait_for(timeout=10000)
    root.get_by_role("heading", name="Birth", exact=True).click()
    root.get_by_text("MCH Weight (g)").first.click()
    root.get_by_text("Add new validation").wait_for(timeout=10000)
    choose(root, page, "Choose operator", "greater than")
    root.locator("input[type='number']").first.fill("500")
    shot(page, "06-numeric-rule-form")
    root.get_by_role("button", name="Create validation rule").click()
    wait_alert(root, "created successfully")

    # The bulk workspace
    root.get_by_role("button", name="Back to overview").click()
    card = root.locator("[data-test='dhis2-uicore-card']").filter(
        has_text="Bulk rules for unvalidated variables").first
    card.wait_for(timeout=10000)
    card.scroll_into_view_if_needed()
    shot(page, "07-bulk-workspace")


def event_flow(root, page):
    """A rule on an event programme, used for the Capture screenshots."""
    # The programme picker's trigger now shows the *selected* programme, not
    # the placeholder, so switch by the current selection.
    choose(root, page, TRACKER_PROGRAM,
           f"{EVENT_PROGRAM} (event programme)")
    root.get_by_text("Bulk rules for unvalidated variables").wait_for(timeout=30000)
    shot(page, "08-event-programme-overview")
    configure_settings(root, page)
    root.get_by_role("heading", name=EVENT_STAGE, exact=True).first.click()
    root.get_by_text(EVENT_DATE_FIELD).first.click()
    root.get_by_text("Add new validation").wait_for(timeout=10000)
    choose(root, page, "Choose relationship", "after")
    choose(root, page, "another tracked date", "a fixed date")
    root.locator("input[type='date']").first.fill(EVENT_BOUND)
    root.get_by_role("button", name="Create validation rule").click()
    wait_alert(root, "created successfully")
    shot(page, "09-event-rule-created")


def mm_frame(page):
    """Metadata Management renders inside the global shell on 2.42+.

    Match on the list's own search box, not on the app title: the shell frame
    carries the title too, and returning it makes every later click miss.
    """
    deadline = time.time() + 60
    while time.time() < deadline:
        for f in page.frames:
            try:
                if f.get_by_placeholder(MM_SEARCH_PLACEHOLDER).count() > 0:
                    return f
            except Exception:
                pass
        page.wait_for_timeout(500)
    return page


def metadata_management_shots(page):
    """The same rules, as DHIS2's own Metadata Management app shows them.

    The list has its own hash route, so navigate straight to it rather than
    clicking through the overview cards.
    """
    page.goto(f"{LBASE}/dhis-web-metadata-management/index.html#/programRules",
              wait_until="domcontentloaded")
    page.wait_for_timeout(10000)
    frame = mm_frame(page)
    frame.get_by_placeholder(MM_SEARCH_PLACEHOLDER).first.fill("TVT")
    page.wait_for_timeout(6000)
    shot(page, "10-metadata-management-list")

    # Open the details panel via the row's info button (Actions column).
    row = frame.locator("tr").filter(has_text=re.compile(r"TVT - ")).first
    if row.count() == 0:
        print("  MM: no TVT rows found after filtering", flush=True)
        return
    try:
        row.get_by_role("button").first.click()
        page.wait_for_timeout(4000)
    except Exception as e:
        print(f"  MM: details click failed: {e}", flush=True)
    shot(page, "11-metadata-management-detail")


def capture_rule_flow(root, page):
    """Create the rule whose message the Capture screenshots show."""
    choose(root, page, EVENT_PROGRAM, CAPTURE_PROGRAM)
    root.get_by_text("Bulk rules for unvalidated variables").wait_for(timeout=30000)
    configure_settings(root, page)
    root.get_by_text(CAPTURE_ATTR).first.click()
    root.get_by_text("Add new validation").wait_for(timeout=10000)
    choose(root, page, "Choose relationship", "after")
    choose(root, page, "another tracked date", "a fixed date")
    root.locator("input[type='date']").first.fill(CAPTURE_BOUND)
    root.get_by_role("button", name="Create validation rule").click()
    wait_alert(root, "created successfully")
    shot(page, "14-capture-source-rule")


def capture_shots(page):
    """The rule firing in Capture during real data entry.

    A date of birth before the rule's fixed bound violates it, so the tool's
    own validation message appears against the field.
    """
    page.goto(f"{LBASE}/dhis-web-capture/index.html"
              f"#/new?orgUnitId={CAPTURE_ORG_UNIT}&programId={CAPTURE_PROGRAM_ID}",
              wait_until="load")
    frame = None
    for _ in range(45):
        page.wait_for_timeout(2000)
        for f in page.frames:
            try:
                if f.get_by_text(CAPTURE_ATTR, exact=False).count() > 0 and \
                        f.locator("input").count() > 2:
                    frame = f
                    break
            except Exception:
                pass
        if frame:
            break
    if not frame:
        shot(page, "12-capture-form-NOT-RENDERED")
        return
    shot(page, "12-capture-form")

    label = frame.get_by_text(CAPTURE_ATTR, exact=False).first
    label.scroll_into_view_if_needed()
    row = label.locator("xpath=ancestor::*[.//input][1]")
    date_input = row.locator("input[placeholder='yyyy-mm-dd']").first
    if date_input.count() == 0:
        date_input = row.locator("input").first
    date_input.click()
    date_input.type(CAPTURE_VIOLATION_DATE, delay=30)
    page.keyboard.press("Escape")
    frame.locator("body").press("Tab")
    page.wait_for_timeout(3500)
    body = frame.locator("body").inner_text()
    fired = f"Must be after {CAPTURE_BOUND}" in body
    print(f"  capture: rule message present={fired}", flush=True)
    label.scroll_into_view_if_needed()
    shot(page, "13-capture-rule-fired")
    if not fired:
        shot(page, "13-capture-rule-fired-FULL", full=True)


def main():
    global LBASE
    lport = start_forwarder()
    LBASE = f"http://localhost:{lport}"
    print(f"forwarder localhost:{lport} -> {REMOTE_HOST}:{REMOTE_PORT}", flush=True)
    cn, cv = session_cookie()
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--disable-dev-shm-usage"])
        ctx = browser.new_context(viewport={"width": 1400, "height": 950})
        ctx.add_cookies([{"name": cn, "value": cv,
                          "domain": "localhost", "path": "/"}])
        page = ctx.new_page()

        if os.environ.get("SKIP_APP") == "1":
            # Iterate on the Capture/Metadata Management steps without
            # rebuilding the rules the previous run left in place.
            metadata_management_shots(page)
            capture_shots(page)
            browser.close()
            return

        page.goto(f"{LBASE}/api/apps/tool-tracker-validation/index.html",
                  wait_until="domcontentloaded")
        root = find_root(page)
        root.get_by_text("Select a programme").first.wait_for(timeout=20000)
        shot(page, "01-empty-state")
        tracker_flow(root, page)
        event_flow(root, page)
        capture_rule_flow(root, page)
        metadata_management_shots(page)
        capture_shots(page)
        browser.close()


def cleanup():
    for pid in (TRACKER_PROGRAM_ID, EVENT_PROGRAM_ID, CAPTURE_PROGRAM_ID):
        _, data = api("GET", f"/api/programRules.json?filter=program.id:eq:{pid}"
                             "&fields=id,description&paging=false")
        for r in (data or {}).get("programRules", []):
            if not (r.get("description") or "").startswith("[DVT]"):
                continue
            _, acts = api("GET", "/api/programRuleActions.json"
                                 f"?filter=programRule.id:eq:{r['id']}"
                                 "&fields=id&paging=false")
            for a in (acts or {}).get("programRuleActions", []):
                api("DELETE", f"/api/programRuleActions/{a['id']}")
            api("DELETE", f"/api/programRules/{r['id']}")
        _, prvs = api("GET", f"/api/programRuleVariables.json?filter=program.id:eq:{pid}"
                             "&filter=name:like:TVT&fields=id&paging=false")
        for prv in (prvs or {}).get("programRuleVariables", []):
            api("DELETE", f"/api/programRuleVariables/{prv['id']}")
        api("DELETE", f"/api/dataStore/tracker-date-validation/config-{pid}")
    print("cleanup done", flush=True)


if __name__ == "__main__":
    failed = False
    if os.environ.get("RESET") == "1":
        # Rule names must be unique per programme, so clear a previous run
        # before re-shooting.
        cleanup()
    try:
        main()
    except Exception:
        traceback.print_exc()
        failed = True
    if CLEANUP:
        cleanup()
    print(f"\ncaptured {len(shots)} screenshots into {OUTDIR}")
    sys.exit(1 if failed else 0)
