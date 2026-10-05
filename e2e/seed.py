#!/usr/bin/env python3
"""Seed and remove the suite's own test metadata on a DISPOSABLE instance.

setup creates, with names unique to the run:
  - a tracker programme with one stage (dates A, B, C, numbers N, M) and a date attribute T,
  - an event programme with one stage (date E),
  - a facility assigned only to these programmes,
  - a test user (random password) whose capture scope is that facility, so Capture and
    Android see nothing else.
T is searchable and the front-page list is on: Android only offers "Create new" after a search.

What a run creates is recorded on the instance, at dataStore e2e-state/<repo>, before it is
created (UIDs are assigned client-side), so a killed run's leftovers are removed by the next one.

Standalone, for manual or Android testing:
  python3 e2e/seed.py setup      # prints the test user and password
  python3 e2e/seed.py teardown   # removes what the record lists, then the record
"""
import secrets
import sys

from common import SetupError, api, get, random_password, uids

SHARING = {"public": "rwrw----", "external": False}
RECORD = "/dataStore/e2e-state/tool-tracker-validation-generator"
KEYS = ["prog", "stage", "deA", "deB", "deC", "deN", "deM", "teaT", "ptea",
        "psdeA", "psdeB", "psdeC", "psdeN", "psdeM",
        "eventProg", "eventStage", "deE", "psdeE", "ou", "user"]


def lookup(path, key, name):
    items = get(f"{path}?fields=id&paging=false&filter=name:eq:{name}")[key]
    if not items:
        raise SetupError(f"no {key} named {name!r}")
    return items[0]["id"]


def superuser_role():
    for role in get("/me?fields=userRoles[id,authorities]")["userRoles"]:
        if "ALL" in role.get("authorities", []):
            return role["id"]
    raise SetupError("DHIS2_USER has no role with the ALL authority")


def root_org_unit():
    return get("/organisationUnits?filter=level:eq:1&fields=id&paging=false")["organisationUnits"][0]["id"]


def build_metadata(ids, names, user, password):
    category_combo = lookup("/categoryCombos", "categoryCombos", "default")
    person = lookup("/trackedEntityTypes", "trackedEntityTypes", "Person")

    def data_element(key, label, value_type):
        return {"id": ids[key], "name": names[key], "shortName": names[key], "formName": label,
                "valueType": value_type, "domainType": "TRACKER", "aggregationType": "NONE",
                "categoryCombo": {"id": category_combo}}

    def psde(psde_key, de_key):
        return {"id": ids[psde_key], "dataElement": {"id": ids[de_key]}, "compulsory": False, "allowFutureDate": True}

    return {
        "organisationUnits": [{"id": ids["ou"], "name": names["ou"], "shortName": names["ou"],
                               "openingDate": "1970-01-01", "parent": {"id": root_org_unit()}}],
        "dataElements": [data_element("deA", "Date A", "DATE"), data_element("deB", "Date B", "DATE"),
                         data_element("deC", "Date C", "DATE"), data_element("deN", "Number N", "NUMBER"),
                         data_element("deM", "Number M", "NUMBER"), data_element("deE", "Date E", "DATE")],
        "trackedEntityAttributes": [{"id": ids["teaT"], "name": names["teaT"], "shortName": names["teaT"],
                                     "formName": "Date T", "valueType": "DATE", "aggregationType": "NONE"}],
        "programs": [
            {"id": ids["prog"], "name": names["prog"], "shortName": names["prog"],
             "programType": "WITH_REGISTRATION", "trackedEntityType": {"id": person},
             "categoryCombo": {"id": category_combo}, "enrollmentDateLabel": "Enrollment date",
             "displayIncidentDate": False, "selectEnrollmentDatesInFuture": True,
             "displayFrontPageList": True, "minAttributesRequiredToSearch": 1,
             "organisationUnits": [{"id": ids["ou"]}],
             "programTrackedEntityAttributes": [{"id": ids["ptea"], "trackedEntityAttribute": {"id": ids["teaT"]},
                                                 "displayInList": True, "mandatory": False,
                                                 "allowFutureDate": True, "searchable": True}],
             "programStages": [{"id": ids["stage"]}], "sharing": SHARING},
            {"id": ids["eventProg"], "name": names["eventProg"], "shortName": names["eventProg"],
             "programType": "WITHOUT_REGISTRATION", "categoryCombo": {"id": category_combo},
             "organisationUnits": [{"id": ids["ou"]}], "programStages": [{"id": ids["eventStage"]}],
             "sharing": SHARING},
        ],
        "programStages": [
            {"id": ids["stage"], "name": names["stage"], "program": {"id": ids["prog"]}, "repeatable": False,
             "executionDateLabel": "Visit date", "autoGenerateEvent": True, "openAfterEnrollment": True,
             "programStageDataElements": [psde("psdeA", "deA"), psde("psdeB", "deB"), psde("psdeC", "deC"),
                                          psde("psdeN", "deN"), psde("psdeM", "deM")],
             "sharing": SHARING},
            {"id": ids["eventStage"], "name": names["eventStage"], "program": {"id": ids["eventProg"]},
             "executionDateLabel": "Report date", "programStageDataElements": [psde("psdeE", "deE")],
             "sharing": SHARING},
        ],
        "users": [{"id": ids["user"], "username": user, "password": password, "firstName": "TVT",
                   "surname": "Tester", "userRoles": [{"id": superuser_role()}],
                   "organisationUnits": [{"id": ids["ou"]}], "dataViewOrganisationUnits": [{"id": ids["ou"]}],
                   "teiSearchOrganisationUnits": [{"id": ids["ou"]}]}],
    }


def import_errors(body):
    response = (body or {}).get("response", body or {})
    messages = [error.get("message")
                for type_report in response.get("typeReports", [])
                for object_report in type_report.get("objectReports", [])
                for error in object_report.get("errorReports", [])]
    return response.get("status"), messages


def setup():
    """Create the test metadata; returns the state teardown() needs."""
    run = secrets.token_hex(2)
    prefix = f"ZZ TVT {run}"
    names = {"prog": f"{prefix} Tracker", "stage": f"{prefix} Visit", "eventProg": f"{prefix} Events",
             "eventStage": f"{prefix} Events stage", "ou": f"{prefix} Facility", "teaT": f"{prefix} Date T"}
    names.update({key: f"{prefix} {label}" for key, label in
                  [("deA", "Date A"), ("deB", "Date B"), ("deC", "Date C"), ("deN", "Number N"),
                   ("deM", "Number M"), ("deE", "Date E")]})
    ids = dict(zip(KEYS, uids(len(KEYS))))
    user, password = f"tvt-{run}", random_password()
    state = {"ids": ids, "names": names, "user": user}
    status, _ = api("PUT", RECORD, state)  # the record first, then the objects
    if status == 404:
        status, _ = api("POST", RECORD, state)
    if status not in (200, 201):
        raise SetupError(f"could not write the e2e record {RECORD}: HTTP {status}")
    status, body = api("POST", "/metadata?atomicMode=ALL&importStrategy=CREATE",
                       build_metadata(ids, names, user, password))
    result, errors = import_errors(body)
    if result != "OK":
        raise SetupError(f"seeding failed (HTTP {status}, {result}): {errors}")
    return {**state, "password": password}


def remove_leftovers():
    """Remove what an earlier, killed run recorded; returns what could not be removed."""
    status, state = api("GET", RECORD)
    if status == 404:
        return []
    if status != 200 or not state:
        return [f"reading {RECORD}: HTTP {status}"]
    print(f"removing leftovers of an earlier run: {state.get('names', {}).get('prog')}", flush=True)
    return teardown(state)


def teardown(state):
    """Remove everything setup() and the tests created; returns the paths that failed."""
    ids = state["ids"]
    failed = []

    def listing(path, key):
        # tolerate objects a half-finished run never created or already removed
        status, body = api("GET", path)
        return (body or {}).get(key, []) if status == 200 else []

    for te in listing(f"/tracker/trackedEntities?program={ids['prog']}&orgUnits={ids['ou']}&fields=trackedEntity",
                      "trackedEntities"):
        api("POST", "/tracker?async=false&importStrategy=DELETE", {"trackedEntities": [{"trackedEntity": te["trackedEntity"]}]})
    for event in listing(f"/tracker/events?program={ids['eventProg']}&orgUnit={ids['ou']}&fields=event", "events"):
        api("POST", "/tracker?async=false&importStrategy=DELETE", {"events": [{"event": event["event"]}]})
    # Tracker deletes are soft: the deleted enrollment still blocks deleting the programme, its
    # data elements and the facility (E4030) until DHIS2 purges soft-deleted records. This purges
    # them instance-wide, one more reason to use a disposable instance.
    api("POST", "/maintenance?softDeletedEventRemoval=true&softDeletedEnrollmentRemoval=true"
                "&softDeletedTrackedEntityRemoval=true&softDeletedTrackedEntityInstanceRemoval=true")
    paths = []
    for program in (ids["prog"], ids["eventProg"]):
        rules = listing(f"/programRules?filter=program.id:eq:{program}&fields=id&paging=false", "programRules")
        prvs = listing(f"/programRuleVariables?filter=program.id:eq:{program}&fields=id&paging=false",
                       "programRuleVariables")
        paths += [f"/programRules/{r['id']}" for r in rules] + [f"/programRuleVariables/{v['id']}" for v in prvs]
    paths += [f"/users/{ids['user']}", f"/programs/{ids['prog']}", f"/programs/{ids['eventProg']}"]
    paths += [f"/dataElements/{ids[key]}" for key in ("deA", "deB", "deC", "deN", "deM", "deE")]
    paths += [f"/trackedEntityAttributes/{ids['teaT']}", f"/organisationUnits/{ids['ou']}"]
    for path in paths:
        status, _ = api("DELETE", path)
        if status not in (200, 204, 404):
            failed.append(f"{path}: HTTP {status}")
    for program in (ids["prog"], ids["eventProg"]):
        status, _ = api("DELETE", f"/dataStore/tracker-date-validation/config-{program}")
        if status not in (200, 204, 404):
            failed.append(f"dataStore config-{program}: HTTP {status}")
    if not failed:
        status, _ = api("DELETE", RECORD)
        if status not in (200, 204, 404):
            failed.append(f"{RECORD}: HTTP {status}")
    return failed


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in ("setup", "teardown"):
        sys.exit(__doc__)
    if sys.argv[1] == "setup":
        failed = remove_leftovers()
        if failed:
            sys.exit(f"leftovers of an earlier run remain: {failed}")
        state = setup()
        print(f"seeded {state['names']['prog']}; test user {state['user']} / {state['password']}")
    else:
        failed = remove_leftovers()
        print("teardown:", "clean" if not failed else failed)
        sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
