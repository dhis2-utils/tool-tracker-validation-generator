"""Shared helpers for the e2e suite (see README.md).

Environment (required, no defaults):
  DHIS2_URL               instance base URL
  DHIS2_USER, DHIS2_PASS  a superuser
"""
import base64
import datetime
import json
import os
import re
import secrets
import string
import time
import urllib.error
import urllib.request


class SetupError(Exception):
    """The suite could not run (exit code 2), as opposed to a failed test."""


def required_env(name):
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"e2e: {name} is not set (no defaults: use a disposable instance)")
    return value


BASE = required_env("DHIS2_URL").rstrip("/")
USER = required_env("DHIS2_USER")
PASS = required_env("DHIS2_PASS")

SINGLESELECT = "[data-test='dhis2-uicore-singleselect']"
SINGLESELECTOPTION = "[data-test='dhis2-uicore-singleselectoption']"
ALERTBAR = "[data-test='dhis2-uicore-alertbar']"
MODAL = "[data-test='dhis2-uicore-modal']"
CARD = "[data-test='dhis2-uicore-card']"


def auth_header(user=USER, password=PASS):
    return "Basic " + base64.b64encode(f"{user}:{password}".encode()).decode()


def api(method, path, body=None, base=None, user=USER, password=PASS, content_type="application/json"):
    """Call the DHIS2 API (path below /api); returns (status, parsed body or None)."""
    data = None
    if body is not None:
        data = body if isinstance(body, bytes) else (body.encode() if isinstance(body, str) else json.dumps(body).encode())
    req = urllib.request.Request(
        f"{base or BASE}/api{path}",
        method=method,
        data=data,
        headers={"Authorization": auth_header(user, password), "Content-Type": content_type},
    )
    try:
        with urllib.request.urlopen(req, timeout=600) as resp:
            raw = resp.read()
            return resp.status, _json_or_none(raw)
    except urllib.error.HTTPError as err:
        return err.code, _json_or_none(err.read())


def _json_or_none(raw):
    try:
        return json.loads(raw) if raw else None
    except ValueError:
        return None


def get(path):
    status, body = api("GET", path)
    if status != 200:
        raise RuntimeError(f"GET {path}: HTTP {status}")
    return body


def uids(count):
    return get(f"/system/id?limit={count}")["codes"]


def session_cookie(base=None, user=USER, password=PASS):
    """A JSESSIONID from a Basic-auth GET /api/me, for the browser context."""
    req = urllib.request.Request(f"{base or BASE}/api/me", headers={"Authorization": auth_header(user, password)})
    with urllib.request.urlopen(req) as resp:
        for header in resp.headers.get_all("Set-Cookie") or []:
            name, _, value = header.split(";", 1)[0].partition("=")
            if "JSESSIONID" in name:
                return name.strip(), value.strip()
    raise RuntimeError(f"no session cookie for {user}")


def random_password():
    """Meets DHIS2's password rules (length, upper, lower, digit, special)."""
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(16)) + "aA1!"


class Results:
    """Collects test outcomes in the shape of results.json (TESTING.md)."""

    def __init__(self, label):
        self.label = label
        self.tests = []

    def add(self, test_id, ok, message=""):
        status = "pass" if ok else "fail"
        self.tests.append({"id": test_id, "status": status, "message": message})
        print(f"[{self.label}] {status.upper():4}  {test_id}  {message}".rstrip(), flush=True)
        return ok

    def skip(self, test_id, message):
        self.tests.append({"id": test_id, "status": "skip", "message": message})
        print(f"[{self.label}] SKIP  {test_id}  {message}", flush=True)

    def tally(self):
        count = lambda status: sum(1 for t in self.tests if t["status"] == status)
        return {"total": len(self.tests), "passed": count("pass"), "failed": count("fail"), "skipped": count("skip")}


# ---- browser helpers for the tool's own UI (@dhis2/ui) ----

def find_app_frame(page, marker=SINGLESELECT, seconds=60):
    """The frame holding the app: the global-shell iframe on 2.42+, the top document before."""
    deadline = time.time() + seconds
    while time.time() < deadline:
        for frame in page.frames:
            try:
                if frame.locator(marker).count() > 0:
                    return frame
            except Exception:
                pass
        page.wait_for_timeout(500)
    raise RuntimeError(f"app not found in any frame: {[f.url for f in page.frames]}")


def choose(scope, trigger_text, option_label, root=None):
    """Open the SingleSelect in scope showing trigger_text and pick option_label.

    Options render in a portal at the frame level, so they are looked up in root.
    """
    root = root or scope
    select = scope.locator(SINGLESELECT).filter(has_text=trigger_text).first
    select.scroll_into_view_if_needed()
    select.click()
    root.locator(SINGLESELECTOPTION).filter(has_text=re.compile(rf"^{re.escape(option_label)}$")).first.click()
    root.page.wait_for_timeout(300)


def wait_alert(root, substring, timeout=30000):
    """Wait for an alert containing substring; return its text once it has gone."""
    alert = root.locator(ALERTBAR).filter(has_text=substring).first
    alert.wait_for(state="visible", timeout=timeout)
    text = alert.inner_text()
    try:
        alert.wait_for(state="detached", timeout=12000)
    except Exception:
        pass
    return text


# ---- dates ----

def today():
    return datetime.date.today()


def iso(day):
    return day.isoformat()


def add_days(day, n):
    return day + datetime.timedelta(days=n)


def add_months(day, n):
    """Calendar months, clamped to the month end (like java.time plusMonths)."""
    month_index = day.month - 1 + n
    year, month = day.year + month_index // 12, month_index % 12 + 1
    next_month = datetime.date(year + (month == 12), month % 12 + 1, 1)
    last_day = (next_month - datetime.timedelta(days=1)).day
    return datetime.date(year, month, min(day.day, last_day))
