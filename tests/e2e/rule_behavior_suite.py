#!/usr/bin/env python3
"""Parameterized, DB-agnostic rule-behavior suite for the Tracker Validation Tool.

Proves that the program rules the tool generates (see src/lib/builder.ts) actually
FIRE (block a violating import) and DON'T fire (allow a valid import) when data is
imported through the DHIS2 tracker API. It is version/DB agnostic: it AUTO-DISCOVERS
a suitable tracker programme (one exposing at least one numeric field and one date
field) so the same script runs against Laos, Sierra Leone, etc.

Rule formats reproduced verbatim from src/lib/builder.ts (POST-FIX forms). A
SHOWERROR rule fires when its condition is TRUE, so the condition expresses the
VIOLATION -- the value the admin means to REJECT. The two "between" rules used to
be logically INVERTED (fired when the value SATISFIED the constraint); the forms
below are the corrected ones and the violate/valid values in this suite are chosen
by SEMANTICS (see "SEMANTIC / regression-guard note" below), so the old inverted
forms would now FAIL.
------------------------------------------------------------------
* date "before current date":  d2:daysBetween(<ref>, V{current_date}) < 0
                                 (fires when the date is in the FUTURE -> violation)
* date "between" L..U (incl.):  d2:hasValue(<ref>) &&
                                 (d2:daysBetween(<ref>, <L>) > 0 || d2:daysBetween(<ref>, <U>) < 0)
                                 (fires when the date is OUTSIDE [L,U] -> violation)
* numeric comparison:          d2:hasValue(#{PRV}) && #{PRV} > 120
                                 (fires when value > 120 -> violation of "must be <= 120")
* numeric "between":           d2:hasValue(#{PRV}) && (#{PRV} < 0 || #{PRV} > 115)
                                 (fires when value is OUTSIDE [0,115] -> violation)
For a data element / attribute date field, builder prepends a null guard
`d2:hasValue(<ref>) && ...`; we reproduce that too.

SEMANTIC / regression-guard note
------------------------------------------------------------------
For every rule, VIOLATE = a value the admin means to REJECT (must FIRE our rule's
E1300 and block the import); VALID = a value the admin means to ACCEPT (must NOT
fire our rule's E1300). Crucially, for the "between" rules the VALID case is an
IN-RANGE value and the VIOLATE case is an OUT-OF-RANGE value:
  * numeric between [0,115]:  VIOLATE = 200 (above max -> fires); VALID = 50 (in range -> silent)
  * date between [L,U]:       VIOLATE = a date OUTSIDE the window (fires); VALID = a date INSIDE (silent)
The IN-RANGE / VALID case staying SILENT is the REGRESSION GUARD for the previously
inverted logic: the old inverted forms (`#{PRV} >= 0 && #{PRV} <= 115`,
`daysBetween <= 0 && >= 0`) fired on in-range values, so with these semantic labels
they would FAIL the "VALID import does NOT fire" assertion.

How SHOWERROR effects surface on POST /api/tracker (async=false), verified against
2.43: a met SHOWERROR condition yields status=ERROR + validationReport.errorReports[]
entry {errorCode:"E1300", args:[ruleUid, content]} and blocks the import (created==0,
TEI not persisted). SHOWWARNING would instead land under warningReports and let the
import through; we use SHOWERROR to match the tool's default.

Env inputs: DHIS2_URL, DHIS2_USER, DHIS2_PASS, LABEL (version tag), OUTDIR.
Everything created (rules, actions, PRVs, tracked entities/enrollments/events) is
removed in a finally block, discovered by a unique marker, and leftovers are verified
to be zero. Exit 0 iff every rule behaved correctly.
"""
import base64
import datetime
import json
import os
import sys
import traceback
import urllib.error
import urllib.request

BASE = os.environ.get("DHIS2_URL", "http://dhis2-agent-laos-v43:8080").rstrip("/")
USER = os.environ.get("DHIS2_USER", "local_admin")
PASS = os.environ.get("DHIS2_PASS", "district")
LABEL = os.environ.get("LABEL", "2.43")
OUTDIR = os.environ.get(
    "OUTDIR",
    "/tool-tracker-date-validation/docs/review-2026-07-13-multiversion-rule-behavior",
)

# Unique marker so cleanup only ever touches what THIS run created.
MARKER = f"[RBT-{LABEL}]"
# PRV names are namespaced by label so parallel runs on different versions can't clash.
PRV_NUM_NAME = f"RBT_{LABEL.replace('.', '_')}_NUM"
PRV_DATE_NAME = f"RBT_{LABEL.replace('.', '_')}_DATE"

NUMERIC_TYPES = {
    "INTEGER", "INTEGER_POSITIVE", "INTEGER_ZERO_OR_POSITIVE",
    "INTEGER_NEGATIVE", "NUMBER", "PERCENTAGE", "UNIT_INTERVAL",
}
DATE_TYPES = {"DATE", "DATETIME"}

results = []          # (rule_key, PASS/FAIL, note)  -- gates the exit code
findings = []         # (title, detail)              -- documented, non-gating
created_teis = []     # tracked-entity UIDs to clean up
created_meta = {"prvs": [], "rules": [], "actions": []}


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


def log(msg):
    print(msg, flush=True)


def record(rule_key, ok, note=""):
    results.append((rule_key, "PASS" if ok else "FAIL", note))
    log(f"{'PASS' if ok else 'FAIL'}: {rule_key}" + (f" - {note}" if note else ""))


# ---------------------------------------------------------------------------
# Value calendar (relative to today, so nothing is hardcoded to a given year).
# ---------------------------------------------------------------------------
TODAY = datetime.date.today()
FUTURE_DATE = (TODAY + datetime.timedelta(days=4 * 365)).isoformat()   # clearly future (after window upper)
RECENT_DATE = (TODAY - datetime.timedelta(days=30)).isoformat()        # within last year (INSIDE window)
OLD_DATE = (TODAY - datetime.timedelta(days=3 * 365)).isoformat()      # >1yr ago, past (BEFORE window lower)
# fixed inclusive window [now-1y, now] expressed as date literals (a tool output when
# the user picks fixed_date bounds); the relative equivalent uses d2:addYears (see findings)
WIN_LOWER = (TODAY - datetime.timedelta(days=365)).isoformat()
WIN_UPPER = TODAY.isoformat()

NUM_CMP_THRESHOLD = 120     # numeric comparison rule "value must be <= 120": fires when value > 120
NUM_BETWEEN_MIN = 0
NUM_BETWEEN_MAX = 115       # numeric-between rule "value must be within [0,115]": fires when OUTSIDE

# Per-rule VIOLATE numbers (semantically REJECTED values that MUST fire our rule):
NUM_CMP_VIOLATE = "150"     # > 120  -> violates "<= 120"
NUM_BETWEEN_VIOLATE = "200" # > 115 (above max, so valid even for INTEGER_ZERO_OR_POSITIVE) -> outside [0,115]

# universal-VALID values: semantically ACCEPTED, so they must fire NONE of the four rules.
#   num 50   -> not >120 (cmp OK) AND inside [0,115] (between: must stay SILENT -> regression guard)
#   date RECENT (30d ago) -> not future (before OK) AND inside [now-1y, now] (between: SILENT -> regression guard)
# NOTE: with the OLD inverted between forms these in-range values would WRONGLY fire, so
# the "VALID import does NOT fire" assertions below are the regression guard for the inversion.
VALID_NUM = "50"
VALID_DATE = RECENT_DATE


# ---------------------------------------------------------------------------
# Auto-discovery
# ---------------------------------------------------------------------------
def _numeric_of(field):
    return field["valueType"] in NUMERIC_TYPES


def discover_candidates():
    """Rank WITH_REGISTRATION programmes exposing a numeric field and a date field.

    Prefers fields exposed as tracked-entity attributes (enrollment-level, simplest
    import) over data elements (need an event). Returns a ranked list of programme
    descriptors; each also carries `requiredAttrs` (mandatory + generated TEAs) so
    imports can pre-fill them and cut down unrelated errorReport noise. The caller
    probes each candidate empirically (does OUR rule's E1300 appear on a violating
    import and vanish on a valid one?) and commits to the first that works -- we no
    longer require a fully clean baseline import.
    """
    fields = (
        "id,name,programType,trackedEntityType[id],organisationUnits[id],"
        "programTrackedEntityAttributes[mandatory,trackedEntityAttribute"
        "[id,name,valueType,generated,unique,optionSet[options[code]]]],"
        "programStages[id,name,programStageDataElements"
        "[compulsory,dataElement[id,name,valueType]]]"
    )
    _, data = api("GET", f"/api/programs.json?fields={fields}&paging=false")
    programs = (data or {}).get("programs", [])

    candidates = []
    for p in programs:
        if p.get("programType") != "WITH_REGISTRATION":
            continue
        if not p.get("organisationUnits"):
            continue
        tet = (p.get("trackedEntityType") or {}).get("id")
        if not tet:
            continue

        attr_num, attr_date, required = [], [], []
        for a in p.get("programTrackedEntityAttributes", []):
            tea = a["trackedEntityAttribute"]
            f = {"kind": "attribute", "id": tea["id"], "name": tea["name"],
                 "valueType": tea["valueType"]}
            if tea["valueType"] in NUMERIC_TYPES:
                attr_num.append(f)
            elif tea["valueType"] in DATE_TYPES:
                attr_date.append(f)
            # obviously-required attributes we can pre-fill to reduce noise
            if a.get("mandatory") or tea.get("generated"):
                opts = (tea.get("optionSet") or {}).get("options") or []
                required.append({
                    "id": tea["id"], "name": tea["name"],
                    "valueType": tea["valueType"],
                    "generated": bool(tea.get("generated")),
                    "unique": bool(tea.get("unique")),
                    "optionCode": (opts[0]["code"] if opts else None),
                })

        de_num, de_date = [], []
        for st in p.get("programStages", []):
            for sde in st.get("programStageDataElements", []):
                de = sde["dataElement"]
                f = {"kind": "dataElement", "id": de["id"], "name": de["name"],
                     "valueType": de["valueType"], "stageId": st["id"],
                     "stageName": st["name"]}
                if de["valueType"] in NUMERIC_TYPES:
                    de_num.append(f)
                elif de["valueType"] in DATE_TYPES:
                    de_date.append(f)

        num = (attr_num or de_num)
        date = (attr_date or de_date)
        if not num or not date:
            continue
        # prefer integer-family numeric attributes for tidy thresholds
        num_sorted = sorted(
            num, key=lambda f: (f["kind"] != "attribute",
                                f["valueType"] == "NUMBER", f["name"]))
        date_sorted = sorted(date, key=lambda f: (f["kind"] != "attribute", f["name"]))
        # attribute-only candidates first (simplest import), then mixed
        rank = (0 if num_sorted[0]["kind"] == "attribute" else 1) + \
               (0 if date_sorted[0]["kind"] == "attribute" else 1)
        prog = {
            "id": p["id"], "name": p["name"],
            "tetId": tet,
            "ou": p["organisationUnits"][0]["id"],
            "numField": num_sorted[0], "dateField": date_sorted[0],
            "requiredAttrs": required,
        }
        candidates.append((rank, prog))

    candidates.sort(key=lambda c: (c[0], c[1]["name"]))
    if not candidates:
        raise RuntimeError("no WITH_REGISTRATION programme with numeric+date field found")
    return [prog for _, prog in candidates]


# ---------------------------------------------------------------------------
# Required-attribute filling (reduce unrelated errorReport noise; do NOT depend
# on a fully clean import -- we only key assertions on OUR rule's UID).
# ---------------------------------------------------------------------------
def _generate_value(attr_id):
    """Reserve a value for a generated (pattern) attribute via the API."""
    code, data = api("GET", f"/api/trackedEntityAttributes/{attr_id}/generate.json")
    if code < 300 and isinstance(data, dict) and data.get("value"):
        return data["value"]
    return None


def _filler_value(attr, seq):
    """A plausible value for a required attribute, keyed by valueType. Text/unique
    values are made unique per import via `seq` to avoid E1064 uniqueness clashes."""
    if attr.get("generated"):
        return _generate_value(attr["id"])
    if attr.get("optionCode"):
        return attr["optionCode"]
    vt = attr["valueType"]
    if vt in NUMERIC_TYPES:
        return "1"
    if vt == "DATE" or vt == "AGE":
        return "2000-01-01"
    if vt == "DATETIME":
        return "2000-01-01T00:00:00.000"
    if vt in ("BOOLEAN", "TRUE_ONLY"):
        return "true"
    if vt == "EMAIL":
        return f"rbt{seq}@example.org"
    if vt == "PHONE_NUMBER":
        return "1234567"
    if vt == "URL":
        return "http://example.org"
    # TEXT / LONG_TEXT / others: unique-ish string
    return f"RBT{seq}"[:50]


_import_seq = [0]


def required_attributes(prog, already_set):
    """Build attribute entries for required TEAs not already carrying a test value."""
    _import_seq[0] += 1
    seq = _import_seq[0]
    out = []
    for attr in prog.get("requiredAttrs", []):
        if attr["id"] in already_set:
            continue
        v = _filler_value(attr, seq)
        if v is not None:
            out.append({"attribute": attr["id"], "value": v})
    return out


# ---------------------------------------------------------------------------
# Import payload builder (attribute + data-element aware)
# ---------------------------------------------------------------------------
def import_tracker(prog, values, register_cleanup=True):
    """Import a fresh TEI+enrollment carrying `values` (keys 'num'/'date').

    Attribute fields go at enrollment level; data-element fields go into an event
    inside the enrollment. Returns (import_report, tei_uid).
    """
    te, en = new_uids(2)
    if register_cleanup:
        created_teis.append(te)

    attributes = []
    datavalues_by_stage = {}
    set_attr_ids = set()
    for key, field in (("num", prog["numField"]), ("date", prog["dateField"])):
        if key not in values:
            continue
        v = values[key]
        if field["kind"] == "attribute":
            attributes.append({"attribute": field["id"], "value": v})
            set_attr_ids.add(field["id"])
        else:
            datavalues_by_stage.setdefault(field["stageId"], []).append(
                {"dataElement": field["id"], "value": v})

    # pre-fill obviously-required attributes to cut unrelated errorReport noise
    attributes += required_attributes(prog, set_attr_ids)

    enrollment = {
        "enrollment": en,
        "program": prog["id"],
        "orgUnit": prog["ou"],
        "enrolledAt": "2024-01-01T00:00:00.000",
        "occurredAt": "2024-01-01T00:00:00.000",
        "status": "ACTIVE",
        "attributes": attributes,
    }
    if datavalues_by_stage:
        events = []
        for stage_id, dvs in datavalues_by_stage.items():
            ev, = new_uids(1)
            events.append({
                "event": ev,
                "program": prog["id"],
                "programStage": stage_id,
                "orgUnit": prog["ou"],
                "occurredAt": "2024-01-01T00:00:00.000",
                "status": "ACTIVE",
                "dataValues": dvs,
            })
        enrollment["events"] = events

    payload = {"trackedEntities": [{
        "trackedEntity": te,
        "trackedEntityType": prog["tetId"],
        "orgUnit": prog["ou"],
        "enrollments": [enrollment],
    }]}
    _, report = api("POST", "/api/tracker?async=false&importStrategy=CREATE", payload)
    return report or {}, te


def our_rule_errors(report):
    """Map {ruleUid -> errorReport} for E1300 effects naming rules WE created."""
    vr = report.get("validationReport") or {}
    out = {}
    for e in vr.get("errorReports", []):
        if e.get("errorCode") != "E1300":
            continue
        for uid in created_meta["rules"]:
            if uid in json.dumps(e.get("args", [])) or uid in (e.get("message") or ""):
                out[uid] = e
    return out


# ---------------------------------------------------------------------------
# Metadata setup
# ---------------------------------------------------------------------------
def make_prv(prog, field, name):
    prv_id, = new_uids(1)
    body = {"id": prv_id, "name": name, "program": {"id": prog["id"]}}
    if field["kind"] == "attribute":
        body["programRuleVariableSourceType"] = "TEI_ATTRIBUTE"
        body["trackedEntityAttribute"] = {"id": field["id"]}
    else:
        body["programRuleVariableSourceType"] = "DATAELEMENT_CURRENT_EVENT"
        body["dataElement"] = {"id": field["id"]}
    code, resp = api("POST", "/api/programRuleVariables", body)
    if code >= 300:
        raise RuntimeError(f"PRV '{name}' create failed: {code} {resp}")
    created_meta["prvs"].append(prv_id)
    return prv_id


def make_rule(prog, name, condition, message):
    rule_id, action_id = new_uids(2)
    code, resp = api("POST", "/api/programRules", {
        "id": rule_id, "name": name,
        "description": f"{MARKER} {name}",
        "program": {"id": prog["id"]},
        "priority": 1, "condition": condition,
    })
    if code >= 300:
        raise RuntimeError(f"rule '{name}' create failed: {code} {resp}")
    created_meta["rules"].append(rule_id)
    code, resp = api("POST", "/api/programRuleActions", {
        "id": action_id, "programRule": {"id": rule_id},
        "programRuleActionType": "SHOWERROR", "content": message,
    })
    if code >= 300:
        raise RuntimeError(f"action for '{name}' failed: {code} {resp}")
    created_meta["actions"].append(action_id)
    return rule_id


def build_rules(prog):
    """Create the representative rule set in the exact tool formats. Returns dict
    rule_key -> {ruleId, violate_values}."""
    num_ref = f"#{{{PRV_NUM_NAME}}}"
    date_ref = f"#{{{PRV_DATE_NAME}}}"

    make_prv(prog, prog["numField"], PRV_NUM_NAME)
    make_prv(prog, prog["dateField"], PRV_DATE_NAME)

    rules = {}

    # 1. date "before current date" (guard prepended for a DE/attr ref)
    cond = f"d2:hasValue({date_ref}) && d2:daysBetween({date_ref}, V{{current_date}}) < 0"
    rid = make_rule(prog, f"RBT {LABEL} date before current",
                    cond, "RBT date must not be in the future")
    rules["date_before_current"] = {
        "ruleId": rid, "condition": cond,
        "violate": {"num": VALID_NUM, "date": FUTURE_DATE},
    }

    # 2. date "between" [L,U] (inclusive). CORRECTED form: the SHOWERROR condition
    #    expresses the VIOLATION, so it fires when the date is OUTSIDE the window
    #    (ref < L  OR  ref > U). Bounds are fixed date literals so the rule is fully
    #    evaluable on every version (the relative addYears/addMonths form is exercised
    #    separately in run_findings). VIOLATE = OLD_DATE (before L -> outside -> fires);
    #    VALID = RECENT_DATE (inside window -> must stay SILENT: regression guard).
    cond = (f"d2:hasValue({date_ref}) && "
            f"(d2:daysBetween({date_ref}, '{WIN_LOWER}') > 0 || "
            f"d2:daysBetween({date_ref}, '{WIN_UPPER}') < 0)")
    rid = make_rule(prog, f"RBT {LABEL} date outside {WIN_LOWER}..{WIN_UPPER}",
                    cond, "RBT date must be within the configured window")
    rules["date_between"] = {
        "ruleId": rid, "condition": cond,
        "violate": {"num": VALID_NUM, "date": OLD_DATE},
    }

    # 3. numeric comparison  value > 120  (violation of "must be <= 120")
    cond = f"d2:hasValue({num_ref}) && {num_ref} > {NUM_CMP_THRESHOLD}"
    rid = make_rule(prog, f"RBT {LABEL} numeric greater than {NUM_CMP_THRESHOLD}",
                    cond, f"RBT value must not exceed {NUM_CMP_THRESHOLD}")
    rules["numeric_compare"] = {
        "ruleId": rid, "condition": cond,
        "violate": {"num": NUM_CMP_VIOLATE, "date": VALID_DATE},
    }

    # 4. numeric "between" [0 .. 115]. CORRECTED form: fires when value is OUTSIDE the
    #    range (value < 0 OR value > 115). VIOLATE = 200 (above max -> outside -> fires;
    #    an above-max value works even for INTEGER_ZERO_OR_POSITIVE fields);
    #    VALID = 50 (in range -> must stay SILENT: regression guard for the inversion).
    cond = (f"d2:hasValue({num_ref}) && "
            f"({num_ref} < {NUM_BETWEEN_MIN} || {num_ref} > {NUM_BETWEEN_MAX})")
    rid = make_rule(prog, f"RBT {LABEL} numeric outside [{NUM_BETWEEN_MIN},{NUM_BETWEEN_MAX}]",
                    cond, f"RBT value must be within [{NUM_BETWEEN_MIN},{NUM_BETWEEN_MAX}]")
    rules["numeric_between"] = {
        "ruleId": rid, "condition": cond,
        "violate": {"num": NUM_BETWEEN_VIOLATE, "date": VALID_DATE},
    }

    log(f"Created {len(rules)} SHOWERROR rules + {len(created_meta['prvs'])} PRVs "
        f"(marker {MARKER}).")
    return rules


# ---------------------------------------------------------------------------
# Test execution
# ---------------------------------------------------------------------------
def run_tests(prog, rules):
    """Assertions key on OUR rule's UID, not on overall import cleanliness. The
    programme may carry unrelated errorReports (missing required attrs, pre-existing
    rules); we filter to E1300 effects naming a rule WE created and ignore the rest."""
    for key, spec in rules.items():
        rid = spec["ruleId"]
        # violating import: THIS rule's E1300 must be present (fires + blocks).
        report, tei = import_tracker(prog, spec["violate"])
        effects = our_rule_errors(report)
        status = report.get("status")
        created = (report.get("stats") or {}).get("created", -1)
        persisted, _ = api("GET", f"/api/tracker/trackedEntities/{tei}")
        ours = set(effects.keys())
        ok_violate = rid in ours          # our rule fired and blocked this import
        our_msg = effects[rid].get("message", "")[:90] if rid in effects else "NONE"
        record(f"{key}: VIOLATING import fires OUR E1300 + blocks",
               ok_violate,
               f"ourRuleFired={rid in ours} status={status} "
               f"otherOurEffects={sorted(ours - {rid})} created={created} "
               f"persistedHTTP={persisted} msg={our_msg}")

        # valid import: THIS rule's E1300 must be ABSENT (import may still error for
        # unrelated reasons -- that's fine, we only assert OUR rule stays silent).
        report, tei = import_tracker(prog, {"num": VALID_NUM, "date": VALID_DATE})
        effects = our_rule_errors(report)
        status = report.get("status")
        created = (report.get("stats") or {}).get("created", 0)
        ok_valid = rid not in effects
        record(f"{key}: VALID import does NOT fire OUR E1300",
               ok_valid,
               f"ourRuleFired={rid in effects} status={status} "
               f"otherOurEffects={sorted(set(effects) - {rid})} created={created}")


def probe(prog, rules):
    """Confirm the rule engine actually EVALUATES our rules on this programme's
    imports before committing. Uses the date_before_current rule: on a violating
    import OUR E1300 must appear; on a valid import it must be absent. Returns
    (usable, reason). If the import is blocked before rule evaluation, our E1300
    never appears -> not usable, caller skips the programme."""
    spec = rules["date_before_current"]
    rid = spec["ruleId"]
    rep_v, _ = import_tracker(prog, spec["violate"])
    viol = rid in our_rule_errors(rep_v)
    rep_ok, _ = import_tracker(prog, {"num": VALID_NUM, "date": VALID_DATE})
    valid = rid in our_rule_errors(rep_ok)
    usable = viol and not valid
    reason = (f"violating->ourE1300={viol} (status={rep_v.get('status')}), "
              f"valid->ourE1300={valid} (status={rep_ok.get('status')})")
    return usable, reason


def reset_attempt():
    """Undo everything created for a rejected candidate so the next one starts clean
    (PRV names/marker are reused, so leftovers would collide)."""
    for te in created_teis:
        api("POST", "/api/tracker?async=false&importStrategy=DELETE",
            {"trackedEntities": [{"trackedEntity": te}]})
    created_teis.clear()
    for aid in created_meta["actions"]:
        api("DELETE", f"/api/programRuleActions/{aid}")
    for rid in created_meta["rules"]:
        api("DELETE", f"/api/programRules/{rid}")
    for pid in created_meta["prvs"]:
        api("DELETE", f"/api/programRuleVariables/{pid}")
    created_meta["actions"].clear()
    created_meta["rules"].clear()
    created_meta["prvs"].clear()


# ---------------------------------------------------------------------------
# Findings: exercise the EXACT relative-bound "between" format the tool emits
# (src/lib/builder.ts uses d2:addYears / d2:addMonths / d2:addDays; the default
# relative unit in the UI is 'years' -> d2:addYears). We check empirically whether
# each relative-bound form actually fires in this version's program-rule engine.
# ---------------------------------------------------------------------------
def run_findings(prog):
    date_ref = f"#{{{PRV_DATE_NAME}}}"  # PRV already created in build_rules
    # A date OUTSIDE the [now-1y, now] window; a correct "between" rule (which fires on
    # OUT-OF-window values) must fire on it -- iff the engine actually evaluates the
    # relative lower bound. OLD_DATE is >1y ago, i.e. before the lower bound.
    outside = OLD_DATE
    variants = {
        "addYears": f"d2:addYears(V{{current_date}}, -1)",
        "addMonths": f"d2:addMonths(V{{current_date}}, -12)",
        "addDays": f"d2:addDays(V{{current_date}}, -365)",
    }
    outcomes = {}
    for name, lower in variants.items():
        cond = (f"d2:hasValue({date_ref}) && "
                f"(d2:daysBetween({date_ref}, {lower}) > 0 || "
                f"d2:daysBetween({date_ref}, V{{current_date}}) < 0)")
        rid = make_rule(prog, f"RBT {LABEL} relBetween {name}", cond,
                        f"RBT relative-between {name}")
        report, tei = import_tracker(prog, {"num": VALID_NUM, "date": outside})
        fired = rid in our_rule_errors(report)
        outcomes[name] = fired
        log(f"  relative-between via d2:{name}: "
            f"{'FIRES' if fired else 'DOES NOT FIRE'} "
            f"(import status={report.get('status')})")

    if not outcomes.get("addYears", True) or not outcomes.get("addMonths", True):
        findings.append((
            "Tool's relative 'between' bounds silently never fire",
            "src/lib/builder.ts emits d2:addYears / d2:addMonths for a relative "
            "current-date bound (UI default unit = 'years'). On this instance those "
            "program rules DO NOT fire for a value OUTSIDE the window, while the "
            "equivalent d2:addDays and fixed-date-literal forms DO fire "
            f"(observed: addYears={outcomes.get('addYears')}, "
            f"addMonths={outcomes.get('addMonths')}, addDays={outcomes.get('addDays')}). "
            "Root cause: the program-rule engine supports d2:addDays but not "
            "d2:addYears/d2:addMonths (those exist only in program indicators). Effect: "
            "any 'between' or comparison rule the tool builds with a relative bound in "
            "years or months is silently non-functional at data entry."))


# ---------------------------------------------------------------------------
# Cleanup + leftover verification
# ---------------------------------------------------------------------------
def cleanup(prog):
    # tracker data first (enrollments/events cascade with the TEI DELETE)
    for te in created_teis:
        api("POST", "/api/tracker?async=false&importStrategy=DELETE",
            {"trackedEntities": [{"trackedEntity": te}]})

    deleted = {"actions": 0, "rules": 0, "prvs": 0}
    pid = prog["id"] if prog else None

    # metadata discovered by marker (so a crashed run still cleans up)
    _, data = api("GET", "/api/programRules.json"
                  + (f"?filter=program.id:eq:{pid}" if pid else "?")
                  + "&fields=id,description&paging=false")
    for r in (data or {}).get("programRules", []):
        if not (r.get("description") or "").startswith(MARKER):
            continue
        _, acts = api("GET", "/api/programRuleActions.json"
                             f"?filter=programRule.id:eq:{r['id']}&fields=id&paging=false")
        for a in (acts or {}).get("programRuleActions", []):
            if api("DELETE", f"/api/programRuleActions/{a['id']}")[0] < 300:
                deleted["actions"] += 1
        if api("DELETE", f"/api/programRules/{r['id']}")[0] < 300:
            deleted["rules"] += 1

    for name in (PRV_NUM_NAME, PRV_DATE_NAME):
        _, prvs = api("GET", "/api/programRuleVariables.json"
                             f"?filter=name:eq:{name}&fields=id&paging=false")
        for prv in (prvs or {}).get("programRuleVariables", []):
            if api("DELETE", f"/api/programRuleVariables/{prv['id']}")[0] < 300:
                deleted["prvs"] += 1

    # verify zero leftovers
    _, data = api("GET", "/api/programRules.json"
                  + (f"?filter=program.id:eq:{pid}" if pid else "?")
                  + "&fields=id,description&paging=false")
    left_rules = [r for r in (data or {}).get("programRules", [])
                  if (r.get("description") or "").startswith(MARKER)]
    left_prvs = []
    for name in (PRV_NUM_NAME, PRV_DATE_NAME):
        _, prvs = api("GET", "/api/programRuleVariables.json"
                             f"?filter=name:eq:{name}&fields=id&paging=false")
        left_prvs += (prvs or {}).get("programRuleVariables", [])
    left_teis = 0
    for te in created_teis:
        code, _ = api("GET", f"/api/tracker/trackedEntities/{te}")
        if code != 404:
            left_teis += 1

    log(f"cleanup: deleted {deleted}; leftovers -> rules={len(left_rules)} "
        f"prvs={len(left_prvs)} teis={left_teis}")
    return len(left_rules) == 0 and len(left_prvs) == 0 and left_teis == 0


def write_report(clean, prog=None, skipped=None):
    os.makedirs(OUTDIR, exist_ok=True)
    path = os.path.join(OUTDIR, f"api-results-{LABEL}.txt")
    lines = [
        f"Rule-behavior API suite results  (label={LABEL})",
        f"Instance: {BASE}",
        f"Run: {datetime.datetime.now().isoformat(timespec='seconds')}",
    ]
    if prog:
        lines += [
            f"Programme: {prog['name']} ({prog['id']})",
            f"  numeric field: {prog['numField']['name']} "
            f"[{prog['numField']['valueType']}] ({prog['numField']['kind']})",
            f"  date field:    {prog['dateField']['name']} "
            f"[{prog['dateField']['valueType']}] ({prog['dateField']['kind']})",
        ]
    if skipped:
        lines.append("Skipped candidates (rule engine did not evaluate our rule):")
        for nm, pid, reason in skipped:
            lines.append(f"  - {nm} ({pid}): {reason}")
    lines += [
        "",
        f"{'RESULT':6}  RULE / CHECK",
        "-" * 78,
    ]
    for rule_key, status, note in results:
        lines.append(f"{status:6}  {rule_key}")
        if note:
            lines.append(f"          {note}")
    if findings:
        lines += ["", "FINDINGS (documented; do not gate the exit code)", "-" * 78]
        for title, detail in findings:
            lines.append(f"* {title}")
            lines.append(f"    {detail}")
    lines += ["", f"cleanup left zero leftovers: {clean}"]
    passed = sum(1 for _, s, _ in results if s == "PASS")
    lines.append(f"summary: {passed}/{len(results)} checks passed")
    with open(path, "w") as f:
        f.write("\n".join(lines) + "\n")
    log(f"\nwrote {path}")


def main():
    prog = None
    failed = False
    skipped = []
    try:
        candidates = discover_candidates()
        log(f"{len(candidates)} candidate programme(s) with a numeric + date field")
        chosen = None
        for cand in candidates:
            log(f"trying programme: {cand['name']} ({cand['id']}) "
                f"num={cand['numField']['name']}[{cand['numField']['valueType']}]"
                f"/{cand['numField']['kind']} "
                f"date={cand['dateField']['name']}[{cand['dateField']['valueType']}]"
                f"/{cand['dateField']['kind']} "
                f"requiredAttrs={len(cand['requiredAttrs'])}")
            rules = build_rules(cand)
            usable, reason = probe(cand, rules)
            if usable:
                log(f"  USABLE: rule engine evaluates our rules ({reason})")
                chosen = cand
                break
            log(f"  skip: rule engine did not evaluate our rule cleanly ({reason})")
            skipped.append((cand["name"], cand["id"], reason))
            reset_attempt()
        if not chosen:
            raise RuntimeError("no candidate programme let the rule engine evaluate our rules")
        prog = chosen
        log(f"DISCOVERED programme: {prog['name']} ({prog['id']}) "
            f"TET={prog['tetId']} OU={prog['ou']}")
        log(f"  numeric field: {prog['numField']['name']} [{prog['numField']['valueType']}] "
            f"({prog['numField']['kind']} {prog['numField']['id']})")
        log(f"  date field:    {prog['dateField']['name']} [{prog['dateField']['valueType']}] "
            f"({prog['dateField']['kind']} {prog['dateField']['id']})")
        run_tests(prog, rules)
        run_findings(prog)
    except Exception:
        traceback.print_exc()
        failed = True
    finally:
        clean = cleanup(prog)
    if skipped:
        print("\n=== skipped candidates (logged reason) ===")
        for nm, pid, reason in skipped:
            print(f"SKIP: {nm} ({pid}) -- {reason}")

    print("\n=== rule-behavior results ===")
    for rule_key, status, note in results:
        print(f"{status}: {rule_key}" + (f" - {note}" if note else ""))
    if findings:
        print("\n=== findings (documented, non-gating) ===")
        for title, detail in findings:
            print(f"FINDING: {title}\n         {detail}")
    write_report(clean, prog, skipped)

    all_ok = (not failed and results
              and all(s == "PASS" for _, s, _ in results) and clean)
    print("\n" + ("ALL PASSED" if all_ok else "FAILURES PRESENT"))
    sys.exit(0 if all_ok else 1)


if __name__ == "__main__":
    main()
