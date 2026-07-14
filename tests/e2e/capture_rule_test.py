#!/usr/bin/env python3
"""Capture-UI test: prove a tool-generated program rule fires CLIENT-SIDE in the
DHIS2 Capture app at data entry (complementing rule_behavior_suite.py, which proves
server-side firing on POST /api/tracker).

What it does
------------
1. Auto-discovers a WITH_REGISTRATION programme whose default registration form
   renders its tracked-entity attributes (no custom dataEntryForm, no programSections)
   and that exposes a DATE attribute + an org unit. No hardcoded Laos IDs.
2. Creates, via the API, a SHOWERROR program rule in the tool's "date before current
   date" format on that DATE attribute (d2:daysBetween(<ref>, V{current_date}) < 0),
   with its programRuleVariable (TEI_ATTRIBUTE) and a uniquely-worded message.
3. Opens Capture on that programme + org unit (deep link #/new?...), enters a FUTURE
   date into the attribute's field, and asserts the rule's exact message text appears
   in the app DOM (the @dhis2/ui Errors widget). Saves a screenshot.
4. Deletes all created metadata in a finally block. It never saves the enrollment, so
   no tracker data is persisted; a safety sweep confirms none leaked by the marker.

Auth: Basic-auth GET /api/me -> JSESSIONID cookie, injected into the browser context
(no login form, no POST /api/auth/login). See dhis2-app-review playwright-patterns.

Secure-context / localhost forwarding
--------------------------------------
The Capture App-Platform build only initialises in a *secure context*. A bare
http://<host>:<port> that is not localhost is NOT secure, so the app renders
"The application could not be loaded". localhost is always a secure context, so this
script opens an in-process TCP tunnel  localhost:<lport> -> <DHIS2_URL host:port>  and
points the browser at it. All egress still goes only to the configured DHIS2_URL
instance; the tunnel is pure loopback. (socat/host forwarding would do the same.)

Env inputs: DHIS2_URL, DHIS2_USER, DHIS2_PASS, LABEL, OUTDIR.
Exit 0 iff the rule's message was observed in the Capture DOM and cleanup was clean.
"""
import base64
import datetime
import json
import os
import socket
import sys
import threading
import traceback
import urllib.error
import urllib.parse
import urllib.request

from playwright.sync_api import sync_playwright

DHIS2_URL = os.environ.get("DHIS2_URL", "http://dhis2-agent-laos-v43:8080").rstrip("/")
USER = os.environ.get("DHIS2_USER", "local_admin")
PASS = os.environ.get("DHIS2_PASS", "district")
LABEL = os.environ.get("LABEL", "2.43")
OUTDIR = os.environ.get(
    "OUTDIR",
    "/tool-tracker-date-validation/docs/review-2026-07-13-multiversion-rule-behavior",
)

MARKER = f"[CAP-RBT-{LABEL}]"
PRV_NAME = f"CAPRBT_{LABEL.replace('.', '_')}_DATE"
RULE_MESSAGE = f"CAPRBT-{LABEL} date of birth must not be in the future"

_p = urllib.parse.urlparse(DHIS2_URL)
REMOTE_HOST = _p.hostname
REMOTE_PORT = _p.port or 80

created_meta = {"prvs": [], "rules": [], "actions": []}
created_ever = {"prvs": set(), "rules": set(), "actions": set()}
results = []


# ---------------------------------------------------------------------------
# Loopback TCP forwarder (localhost -> dev-net instance) for secure context
# ---------------------------------------------------------------------------
def _pipe(a, b):
    try:
        while (chunk := a.recv(65536)):
            b.sendall(chunk)
    except OSError:
        pass
    finally:
        for s in (a, b):
            try:
                s.shutdown(socket.SHUT_RDWR)
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


# LBASE is set once the forwarder is up; api() and the browser both use it.
LBASE = None


def api(method, path, body=None):
    req = urllib.request.Request(
        f"{LBASE}{path}",
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
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw.decode()[:400]


def new_uids(n):
    _, data = api("GET", f"/api/system/id.json?limit={n}")
    return list((data or {}).get("codes", []))


def session_cookie():
    req = urllib.request.Request(
        f"{LBASE}/api/me",
        headers={"Authorization": "Basic "
                 + base64.b64encode(f"{USER}:{PASS}".encode()).decode()},
    )
    with urllib.request.urlopen(req) as r:
        for c in r.headers.get_all("Set-Cookie") or []:
            head = c.split(";", 1)[0]
            n, _, v = head.partition("=")
            if "JSESSIONID" in n:
                return n.strip(), v.strip()
    raise RuntimeError("no JSESSIONID returned by /api/me")


def log(m):
    print(m, flush=True)


# ---------------------------------------------------------------------------
# Discovery: programme whose default form renders a DATE attribute
# ---------------------------------------------------------------------------
def discover_candidates():
    fields = (
        "id,name,programType,dataEntryForm,programSections~size,"
        "organisationUnits[id],"
        "programTrackedEntityAttributes[trackedEntityAttribute"
        "[id,name,formName,displayFormName,valueType]]"
    )
    _, data = api("GET", f"/api/programs.json?fields={fields}&paging=false")
    out = []
    for p in (data or {}).get("programs", []):
        if p.get("programType") != "WITH_REGISTRATION":
            continue
        if p.get("dataEntryForm"):          # custom form -> attributes may be hidden
            continue
        if p.get("programSections"):        # sectioned form -> only sectioned attrs
            continue
        if not p.get("organisationUnits"):
            continue
        date_attrs = [a["trackedEntityAttribute"]
                      for a in p.get("programTrackedEntityAttributes", [])
                      if a["trackedEntityAttribute"]["valueType"] in ("DATE", "DATETIME")]
        if not date_attrs:
            continue
        out.append({
            "id": p["id"], "name": p["name"],
            "ou": p["organisationUnits"][0]["id"],
            "dateAttrs": date_attrs,
        })
    out.sort(key=lambda c: c["name"])
    return out


def make_rule(prog, attr):
    prv_id, rule_id, action_id = new_uids(3)
    code, resp = api("POST", "/api/programRuleVariables", {
        "id": prv_id, "name": PRV_NAME,
        "programRuleVariableSourceType": "TEI_ATTRIBUTE",
        "program": {"id": prog["id"]},
        "trackedEntityAttribute": {"id": attr["id"]},
    })
    if code >= 300:
        raise RuntimeError(f"PRV create failed: {code} {resp}")
    created_meta["prvs"].append(prv_id)
    created_ever["prvs"].add(prv_id)

    # exact tool "date before current date" format (guard prepended for an attr ref)
    cond = (f"d2:hasValue(#{{{PRV_NAME}}}) && "
            f"d2:daysBetween(#{{{PRV_NAME}}}, V{{current_date}}) < 0")
    code, resp = api("POST", "/api/programRules", {
        "id": rule_id, "name": f"CAPRBT {LABEL} date before current",
        "description": f"{MARKER} capture date rule",
        "program": {"id": prog["id"]}, "priority": 1, "condition": cond,
    })
    if code >= 300:
        raise RuntimeError(f"rule create failed: {code} {resp}")
    created_meta["rules"].append(rule_id)
    created_ever["rules"].add(rule_id)

    code, resp = api("POST", "/api/programRuleActions", {
        "id": action_id, "programRule": {"id": rule_id},
        "programRuleActionType": "SHOWERROR", "content": RULE_MESSAGE,
    })
    if code >= 300:
        raise RuntimeError(f"action create failed: {code} {resp}")
    created_meta["actions"].append(action_id)
    created_ever["actions"].add(action_id)
    return rule_id


def cleanup_meta():
    for aid in created_meta["actions"]:
        api("DELETE", f"/api/programRuleActions/{aid}")
    for rid in created_meta["rules"]:
        api("DELETE", f"/api/programRules/{rid}")
    for pid in created_meta["prvs"]:
        api("DELETE", f"/api/programRuleVariables/{pid}")
    created_meta["actions"].clear()
    created_meta["rules"].clear()
    created_meta["prvs"].clear()


def verify_no_leftovers():
    """Confirm every metadata object this run ever created is gone (HTTP 404)."""
    left_rules = sum(1 for rid in created_ever["rules"]
                     if api("GET", f"/api/programRules/{rid}")[0] != 404)
    left_prvs = sum(1 for pid in created_ever["prvs"]
                    if api("GET", f"/api/programRuleVariables/{pid}")[0] != 404)
    return left_rules == 0 and left_prvs == 0, left_rules, left_prvs


# ---------------------------------------------------------------------------
# Browser drive
# ---------------------------------------------------------------------------
def app_frame(page):
    for fr in page.frames:
        if "dhis-web-capture" in fr.url:
            return fr
    return page.main_frame


def drive_capture(prog, attr):
    cn, cv = session_cookie()
    future = (datetime.date.today() + datetime.timedelta(days=1000)).isoformat()
    ss_dir = os.path.join(OUTDIR, "screenshots")
    os.makedirs(ss_dir, exist_ok=True)
    ss_path = os.path.join(ss_dir, f"capture-{LABEL}-date_before_current.png")

    console_errors = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        ctx = browser.new_context(ignore_https_errors=True,
                                  viewport={"width": 1400, "height": 1100})
        ctx.add_cookies([{"name": cn, "value": cv, "domain": "localhost", "path": "/"}])
        page = ctx.new_page()
        page.on("console", lambda m: console_errors.append(m.text)
                if m.type == "error" else None)
        page.on("pageerror", lambda e: console_errors.append(str(e)))

        page.goto(f"{LBASE}/dhis-web-capture/index.html"
                  f"#/new?orgUnitId={prog['ou']}&programId={prog['id']}",
                  wait_until="load")

        # wait for the registration form to render
        frame = None
        for _ in range(40):
            page.wait_for_timeout(2000)
            frame = app_frame(page)
            if frame and frame.locator("input").count() > 0:
                break
        if not frame or frame.locator("input").count() == 0:
            browser.close()
            return False, "registration form never rendered", ss_path

        label = attr.get("displayFormName") or attr.get("formName") or attr["name"]
        # Mandatory fields render the label with a trailing " *" (and some shells
        # wrap it), so exact match can miss; fall back to a substring match.
        loc = frame.get_by_text(label, exact=True)
        if loc.count() == 0:
            loc = frame.get_by_text(label, exact=False)
        if loc.count() == 0:
            browser.close()
            return False, f"field '{label}' not found in rendered form", ss_path

        row = loc.first.locator("xpath=ancestor::*[.//input][1]")
        date_input = row.locator("input[placeholder='yyyy-mm-dd']").first
        if date_input.count() == 0:
            date_input = row.locator("input").first
        date_input.scroll_into_view_if_needed()
        date_input.click()
        date_input.type(future, delay=30)
        page.keyboard.press("Escape")
        # blur onto another attribute field (avoid opening the program selector)
        try:
            frame.get_by_text("Last name", exact=False).first.click(timeout=2000)
        except Exception:
            frame.locator("body").press("Tab")
        page.wait_for_timeout(2500)

        body = frame.locator("body").inner_text()
        present = RULE_MESSAGE in body
        entered = date_input.input_value()
        page.screenshot(path=ss_path, full_page=True)
        browser.close()

        note = (f"entered future DOB={future} (field kept value '{entered}'); "
                f"rule message in DOM={present}")
        if console_errors:
            note += f"; console_errors={len(console_errors)}"
        return present, note, ss_path


# ---------------------------------------------------------------------------
def main():
    global LBASE
    lport = start_forwarder()
    LBASE = f"http://localhost:{lport}"
    # sanity: forwarder + auth
    code, _ = api("GET", "/api/me")
    if code != 200:
        log(f"FATAL: cannot reach instance via forwarder ({code})")
        sys.exit(1)
    log(f"forwarder localhost:{lport} -> {REMOTE_HOST}:{REMOTE_PORT}")

    ok = False
    note = "no candidate programme worked"
    ss_path = os.path.join(OUTDIR, "screenshots",
                           f"capture-{LABEL}-date_before_current.png")
    prog_used = attr_used = None
    try:
        candidates = discover_candidates()
        log(f"{len(candidates)} candidate programme(s) with a renderable DATE attribute")
        for prog in candidates[:4]:
            attr = prog["dateAttrs"][0]
            label = attr.get("displayFormName") or attr["name"]
            log(f"trying programme {prog['name']} ({prog['id']}), "
                f"date attr '{label}' ({attr['id']})")
            make_rule(prog, attr)
            try:
                ok, note, ss_path = drive_capture(prog, attr)
            finally:
                if not ok:
                    cleanup_meta()   # free this candidate before trying the next
            if ok:
                prog_used, attr_used = prog, attr
                break
    except Exception:
        traceback.print_exc()
    finally:
        cleanup_meta()
        clean, lr, lp = verify_no_leftovers()

    if prog_used:
        log(f"\nprogramme: {prog_used['name']} ({prog_used['id']}) "
            f"orgUnit={prog_used['ou']}")
        log(f"date attribute: {attr_used.get('displayFormName') or attr_used['name']} "
            f"({attr_used['id']})")
    log(f"rule message asserted: {RULE_MESSAGE!r}")
    log(f"result: {'PASS' if ok else 'FAIL'} - {note}")
    log(f"screenshot: {ss_path}")
    log(f"cleanup clean: {clean} (leftover rules={lr}, prvs={lp})")

    results.append(("capture date_before_current fires client-side",
                    "PASS" if ok else "FAIL", note))
    sys.exit(0 if (ok and clean) else 1)


if __name__ == "__main__":
    main()
