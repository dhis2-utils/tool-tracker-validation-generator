"""The rule-matrix cases, with dates relative to today.

Each case sets field values on one Capture form and states whether the rule's message must be
shown ("fires"). Fields a case doesn't set are left empty; on the event form the visit date
defaults to the enrollment date.
"""
from common import add_days, add_months, iso, today

REGISTRATION = "registration"
EVENT = "event"


def legacy_months_between(first, second):
    """d2:monthsBetween in Capture's legacy JS engine (moment.js), used by Capture web on
    DHIS2 < 2.42: whole months m such that first + m months (clamped to the month end) <= second.
    The Kotlin engine (Android, server, Capture on >= 2.42) counts 31 Aug -> 30 Sep as 0."""
    months = (second.year - first.year) * 12 + second.month - first.month
    while months > 0 and add_months(first, months) > second:
        months -= 1
    return months


def r6_fires_legacy(t, enrol):
    """R6 = within 1 month before enrollment, as the legacy engine evaluates the app's condition."""
    return legacy_months_between(add_days(t, 1), enrol) >= 1 or t > enrol


def build_cases():
    now = today()
    enrol = add_days(now, -2)
    a0 = add_days(enrol, -10)
    month_back = add_months(enrol, -1)

    def reg(case_id, rule, enrollment, t, fires):
        values = {"Enrollment date": iso(enrollment)}
        if t is not None:
            values["Date T"] = iso(t)
        case = {"id": case_id, "rule": rule, "form": REGISTRATION, "values": values, "fires": fires}
        if rule == "R6":
            case["fires_legacy_web"] = r6_fires_legacy(t, enrollment)
        return case

    def event(case_id, rule, fires, **fields):
        values = {"Visit date": iso(enrol), "Date A": "", "Date B": "", "Number N": "", "Number M": ""}
        values.update({key.replace("_", " "): value for key, value in fields.items()})
        return {"id": case_id, "rule": rule, "form": EVENT, "values": values, "fires": fires}

    return enrol, [
        reg("R8-today", "R8", now, None, False),
        reg("R8-tomorrow", "R8", add_days(now, 1), None, True),
        reg("R6-minus-1-month", "R6", enrol, month_back, False),
        reg("R6-minus-1-month-1-day", "R6", enrol, add_days(month_back, -1), True),
        reg("R6-same-day", "R6", enrol, enrol, False),
        reg("R6-day-after", "R6", enrol, add_days(enrol, 1), True),
        event("R1-yesterday", "R1", False, Date_A=iso(add_days(now, -1))),
        event("R1-today", "R1", False, Date_A=iso(now)),
        event("R1-tomorrow", "R1", True, Date_A=iso(add_days(now, 1))),
        event("R7-2000-01-01", "R7", True, Date_A="2000-01-01"),
        event("R7-2000-01-02", "R7", False, Date_A="2000-01-02"),
        event("R2-same-day", "R2", False, Date_A=iso(a0), Date_B=iso(a0)),
        event("R2-plus-7", "R2", False, Date_A=iso(a0), Date_B=iso(add_days(a0, 7))),
        event("R2-plus-8", "R2", True, Date_A=iso(a0), Date_B=iso(add_days(a0, 8))),
        event("R2-minus-1", "R2", True, Date_A=iso(a0), Date_B=iso(add_days(a0, -1))),
        event("R2-A-empty", "R2", False, Date_B=iso(add_days(a0, 30))),
        event("R3-same-day", "R3", False),
        event("R3-day-before", "R3", True, Visit_date=iso(add_days(enrol, -1))),
        event("R4-35", "R4", False, Number_N="35"),
        event("R4-42", "R4", False, Number_N="42"),
        event("R4-34.9", "R4", True, Number_N="34.9"),
        event("R4-42.1", "R4", True, Number_N="42.1"),
        event("R5-less", "R5", False, Number_N="40", Number_M="39"),
        event("R5-equal", "R5", True, Number_N="40", Number_M="40"),
        event("R5-N-empty", "R5", False, Number_M="50"),
    ]


# Error rules whose "complete is blocked" behaviour is checked once, with these cases.
COMPLETE_BLOCK_CASES = ["R1-tomorrow", "R7-2000-01-01", "R2-plus-8", "R3-day-before", "R4-42.1"]
