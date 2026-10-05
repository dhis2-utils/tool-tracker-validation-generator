"""The rule matrix in the Capture web app, as the seeded test user.

Checks every case in cases.py on the registration form and the stage's event form, that error
messages block saving the person / completing the event, and that no other matrix rule's message
appears.

Capture only initialises in a secure context, so the browser talks to an in-process
localhost -> instance TCP tunnel.
"""
import os
import socket
import threading
import time
import urllib.parse

from cases import COMPLETE_BLOCK_CASES, EVENT, REGISTRATION, build_cases
from common import BASE, api, iso, session_cookie

COMPLETE_CHECKBOX = "#completeYes"
SAVE_PERSON = "Save person"
EVENT_FORM_MARKER = "Date A"


def _pipe(src, dst):
    try:
        while chunk := src.recv(65536):
            dst.sendall(chunk)
    except OSError:
        pass
    finally:
        for sock in (src, dst):
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass


def start_tunnel():
    remote = urllib.parse.urlparse(BASE)
    server = socket.socket()
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(("127.0.0.1", 0))
    server.listen()

    def loop():
        while True:
            try:
                client, _ = server.accept()
                upstream = socket.create_connection((remote.hostname, remote.port or 80))
            except OSError:
                continue
            threading.Thread(target=_pipe, args=(client, upstream), daemon=True).start()
            threading.Thread(target=_pipe, args=(upstream, client), daemon=True).start()

    threading.Thread(target=loop, daemon=True).start()
    return f"http://localhost:{server.getsockname()[1]}"


class Capture:
    def __init__(self, page, messages, shots_dir, label):
        self.page = page
        self.messages = messages
        self.shots_dir = shots_dir
        self.label = label

    def frame(self):
        for frame in self.page.frames:
            if "capture" in frame.url and frame != self.page.main_frame:
                return frame
        return self.page.main_frame

    def text(self):
        return self.frame().locator("body").inner_text()

    def wait_for_text(self, needle, seconds=60):
        deadline = time.time() + seconds
        while time.time() < deadline:
            try:
                if needle in self.text():
                    return True
            except Exception:
                pass
            self.page.wait_for_timeout(1000)
        return False

    def field(self, label):
        frame = self.frame()
        loc = frame.get_by_text(label, exact=True)
        if loc.count() == 0:
            loc = frame.get_by_text(label, exact=False)
        return loc.first.locator("xpath=ancestor::*[.//input][1]").locator("input").first

    def set(self, label, value):
        inp = self.field(label)
        inp.scroll_into_view_if_needed()
        inp.click()
        inp.press("Control+a")
        inp.press("Backspace")
        if value:
            inp.type(value, delay=20)
        self.page.keyboard.press("Escape")
        inp.press("Tab")
        self.page.wait_for_timeout(1200)

    def apply(self, values):
        for label, value in values.items():
            self.set(label, value)
        self.page.wait_for_timeout(800)
        return {label: self.field(label).input_value() for label in values}

    def shown(self):
        text = self.text()
        return sorted(key for key, message in self.messages.items() if message in text)

    def shot(self, name):
        self.page.screenshot(path=os.path.join(self.shots_dir, f"{self.label}-capture-{name}.png"), full_page=True)


class CaptureRun:
    def __init__(self, cap, results, state, legacy_engine):
        self.cap = cap
        self.results = results
        self.ids = state["ids"]
        # Capture web uses its legacy JS rule engine on DHIS2 < 2.42 (see cases.legacy_months_between).
        self.legacy_engine = legacy_engine

    def expected(self, case):
        if self.legacy_engine and "fires_legacy_web" in case:
            return case["fires_legacy_web"]
        return case["fires"]

    def check(self, case):
        try:
            got = self.cap.apply(case["values"])
        except Exception as err:  # one stuck field fails this case, not the run
            self.cap.shot(case["id"])
            self.cap.page.keyboard.press("Escape")
            self.results.add(f"capture-{case['id']}", False, f"{type(err).__name__}: {err}".splitlines()[0])
            return
        observed = self.cap.shown()
        unexpected = [key for key in observed if key != case["rule"]]
        fired = case["rule"] in observed
        want = self.expected(case)
        notes = []
        if got != case["values"]:
            notes.append(f"values not applied: {got}")
        if fired != want:
            notes.append(f"expected {'fires' if want else 'silent'}, {'fired' if fired else 'silent'}")
        if unexpected:
            notes.append(f"other rules shown: {unexpected}")
        if want != case["fires"]:
            notes.append("legacy-engine expectation")
        ok = got == case["values"] and fired == want and not unexpected
        if not ok:
            self.cap.shot(case["id"])
        self.results.add(f"capture-{case['id']}", ok, "; ".join(notes))

    def tracked_entities(self):
        status, body = api("GET", f"/tracker/trackedEntities?program={self.ids['prog']}&orgUnits={self.ids['ou']}"
                                  "&fields=trackedEntity")
        return [te["trackedEntity"] for te in (body or {}).get("trackedEntities", [])] if status == 200 else []

    def event_status(self):
        _, body = api("GET", f"/tracker/events?program={self.ids['prog']}&orgUnit={self.ids['ou']}&fields=event,status")
        events = (body or {}).get("events", [])
        return events[0]["status"] if events else None

    def registration(self, cases, enrol):
        for case in [c for c in cases if c["form"] == REGISTRATION]:
            self.check(case)
        # an R6 error must stop the person being saved
        day_after = next(c for c in cases if c["id"] == "R6-day-after")["values"]["Date T"]
        self.cap.apply({"Enrollment date": iso(enrol), "Date T": day_after})
        self.cap.frame().get_by_role("button", name=SAVE_PERSON).click()
        self.cap.page.wait_for_timeout(4000)
        saved = self.tracked_entities()
        self.results.add("capture-R6-blocks-save-person", not saved, f"{len(saved)} saved" if saved else "")
        self.cap.apply({"Enrollment date": iso(enrol), "Date T": iso(enrol)})
        self.cap.frame().get_by_role("button", name=SAVE_PERSON).click()
        if not self.cap.wait_for_text(EVENT_FORM_MARKER, 90):
            self.cap.shot("after-save-person")
            raise RuntimeError("the event form did not open after saving the person")

    def event(self, cases):
        for case in [c for c in cases if c["form"] == EVENT]:
            self.check(case)
        by_id = {c["id"]: c for c in cases}
        completed = False
        for case_id in COMPLETE_BLOCK_CASES:
            if completed:
                # the event is completed; the remaining checks would mean nothing
                self.results.skip(f"capture-{case_id}-blocks-complete", "event already completed")
                continue
            self.cap.apply(by_id[case_id]["values"])
            checkbox = self.cap.frame().locator(COMPLETE_CHECKBOX)
            if checkbox.count() and not checkbox.is_checked():
                checkbox.click(force=True)
            self.cap.frame().get_by_role("button", name="Save", exact=True).click()
            self.cap.page.wait_for_timeout(5000)
            status = self.event_status()
            ok = self.results.add(f"capture-{case_id}-blocks-complete", status != "COMPLETED", f"server status {status}")
            if not ok:
                self.cap.shot(f"complete-{case_id}")
                completed = True

    def remaining(self, cases, done):
        """Record the cases a setup failure kept from running, so the tally stays complete."""
        ids = [f"capture-{c['id']}" for c in cases]
        ids += ["capture-R6-blocks-save-person"] + [f"capture-{c}-blocks-complete" for c in COMPLETE_BLOCK_CASES]
        for test_id in ids:
            if test_id not in done:
                self.results.add(test_id, False, "not run: Capture failed earlier")


def run(browser, results, state, shots_dir):
    version = api("GET", "/system/info")[1]["version"]
    legacy = int(version.split(".")[1]) < 42
    print(f"Capture web rule engine: {'legacy JS' if legacy else 'Kotlin'} (DHIS2 {version})", flush=True)
    enrol, cases = build_cases()
    local_base = start_tunnel()
    name, value = session_cookie(local_base, state["user"], state["password"])
    context = browser.new_context(viewport={"width": 1400, "height": 1100})
    context.add_cookies([{"name": name, "value": value, "domain": "localhost", "path": "/"}])
    page = context.new_page()
    # The rule engine logs a rule it cannot evaluate (e.g. on an empty date) and
    # treats it as not firing; the matrix rules must never cause that.
    engine_errors = []
    page.on("console", lambda m: engine_errors.append(m.text)
            if m.type == "error" and "Rule " in m.text and "error" in m.text.lower() else None)
    cap = Capture(page, {key: rule["message"] for key, rule in state["rules"].items()}, shots_dir, results.label)
    capture_run = CaptureRun(cap, results, state, legacy)
    ids = state["ids"]
    try:
        page.goto(f"{local_base}/dhis-web-capture/index.html#/new?orgUnitId={ids['ou']}&programId={ids['prog']}")
        if not cap.wait_for_text("Enrollment date", 120):
            cap.shot("open")
            raise RuntimeError("the Capture registration form did not load")
        capture_run.registration(cases, enrol)
        capture_run.event(cases)
    except Exception as err:
        cap.shot("stopped")
        print(f"Capture web stopped: {err}", flush=True)
        capture_run.remaining(cases, {t["id"] for t in results.tests})
    finally:
        context.close()
    results.add("capture-no-rule-engine-errors", not engine_errors,
                "; ".join(e[:200] for e in engine_errors[:3]))
