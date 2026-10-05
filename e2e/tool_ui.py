"""The tool's own UI, driven in the installed app on the seeded programmes.

Creates the rule matrix (README.md) through the app's form, edits two of the rules, runs a
bulk apply and its clean-up offer, deletes a rule, and covers the event programme. Every write
is checked by reading the server's state back.
"""
import json
import os
from urllib.parse import urlparse

from common import BASE, CARD, MODAL, api, choose, find_app_frame, get, session_cookie, wait_alert

OVERVIEW_MARKER = "Bulk rules for unvalidated variables"
RELATIONSHIP = "Choose relationship"
TARGET_MODE = "another tracked date"
CREATE = "Create validation rule"
UPDATE = "Update validation rule"
MESSAGE_PLACEHOLDER = "e.g. Birth date cannot be after enrollment date"
CUSTOM_R8_MESSAGE = "Enrollment date cannot be in the future"
BENIGN_CONSOLE = ("secure context", "logo_banner", "Failed to load resource")


class ToolUi:
    def __init__(self, page, results, state, app_url, shots_dir):
        self.page = page
        self.results = results
        self.state = state
        self.ids = state["ids"]
        self.names = state["names"]
        self.app_url = app_url
        self.shots_dir = shots_dir
        self.root = None
        self.console_errors = []
        page.on("console", lambda m: self.console_errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: self.console_errors.append(str(e)))

    # ---- plumbing ----

    def shot(self, name):
        self.page.screenshot(path=os.path.join(self.shots_dir, f"{self.results.label}-{name}.png"), full_page=True)

    def step(self, test_id, action):
        """Run one test; action returns (ok, message). An exception is a failure."""
        try:
            ok, message = action()
        except Exception as err:  # a failed locator or API call fails this test only
            ok, message = False, f"{type(err).__name__}: {err}".splitlines()[0]
        if not ok:
            self.shot(f"FAIL-{test_id}")
        return self.results.add(test_id, ok, message)

    def open_app(self):
        self.page.goto(self.app_url, wait_until="domcontentloaded")
        self.root = find_app_frame(self.page)

    def back_to_overview(self):
        back = self.root.get_by_role("button", name="Back to overview")
        if back.count():
            back.first.click()
        self.root.get_by_text(OVERVIEW_MARKER).first.wait_for(timeout=30000)

    def open_variable(self, name, stage=None):
        self.back_to_overview()
        entry = self.root.get_by_text(name, exact=True)
        if stage and not entry.first.is_visible():
            self.root.get_by_role("heading", name=stage, exact=True).first.click()
        entry.first.click()
        self.root.get_by_text("Add new validation").wait_for(timeout=15000)

    def app_rules(self, program):
        rules = get(f"/programRules?filter=program.id:eq:{program}&paging=false"
                    "&fields=id,name,description,condition,programRuleActions[programRuleActionType,content]")
        return [r for r in rules["programRules"] if (r.get("description") or "").startswith("[DVT]")]

    def refs(self, program):
        """#{name} of the program rule variable bound to each data element / attribute."""
        prvs = get(f"/programRuleVariables?filter=program.id:eq:{program}&paging=false"
                   "&fields=name,dataElement[id],trackedEntityAttribute[id]")["programRuleVariables"]
        out = {}
        for prv in prvs:
            target = (prv.get("dataElement") or prv.get("trackedEntityAttribute") or {}).get("id")
            out[target] = f"#{{{prv['name']}}}"
        return out

    def create_and_read_back(self, program, fill):
        before = {r["id"] for r in self.app_rules(program)}
        fill()
        self.root.get_by_role("button", name=CREATE).click()
        wait_alert(self.root, "created successfully")
        new = [r for r in self.app_rules(program) if r["id"] not in before]
        if len(new) != 1:
            raise AssertionError(f"expected 1 new rule, found {len(new)}")
        return new[0]

    # ---- tracker programme ----

    def select_program(self, label):
        choose(self.root, "Select a programme", label)
        self.root.get_by_text(OVERVIEW_MARKER).first.wait_for(timeout=30000)
        return True, ""

    def configure_settings(self, program):
        self.root.get_by_text("Settings required").first.wait_for(timeout=15000)
        self.root.get_by_role("button", name="Programme settings").click()
        modal = self.root.locator(MODAL)
        modal.wait_for(timeout=10000)
        modal.get_by_placeholder("e.g. EIR").nth(0).fill("TVT")
        modal.get_by_placeholder("e.g. EIR").nth(1).fill("TVT")
        modal.get_by_role("button", name="Save settings").click()
        wait_alert(self.root, "Settings saved")
        _, config = api("GET", f"/dataStore/tracker-date-validation/config-{program}")
        want = {"programRulePrefix": "TVT", "programRuleVariablePrefix": "TVT"}
        return config == want, json.dumps(config) if config != want else ""

    def matrix_specs(self):
        """(key, variable name, stage heading or None, form filler, expected condition(refs))."""
        n, root = self.names, lambda: self.root
        stage = n["stage"]
        ids = self.ids

        def date_vs(relationship, mode, extra=None):
            def fill():
                choose(root(), RELATIONSHIP, relationship)
                if extra:
                    extra()
                if mode:
                    choose(root(), TARGET_MODE, mode)
            return fill

        def within(relationship, amount, unit, target):
            def fill():
                choose(root(), RELATIONSHIP, relationship)
                root().get_by_placeholder("30", exact=True).fill(str(amount))
                if unit != "days":
                    choose(root(), "days", unit)
                choose(root(), "Choose date...", target)
            return fill

        def fixed(relationship, date):
            def fill():
                date_vs(relationship, "a fixed date")()
                root().locator("input[type='date']").first.fill(date)
            return fill

        def numeric_between(low, high):
            def fill():
                choose(root(), "Choose operator", "between")
                root().get_by_placeholder("min", exact=True).fill(str(low))
                root().get_by_placeholder("max", exact=True).fill(str(high))
            return fill

        def numeric_vs_field(operator, field):
            def fill():
                choose(root(), "Choose operator", operator)
                choose(root(), "a fixed value", "another field")
                choose(root(), "Choose field...", field)
            return fill

        enrollment = "Enrollment date (enrollment date)"

        def other_date(relationship, target):
            def fill():
                choose(root(), RELATIONSHIP, relationship)
                choose(root(), "Choose date...", target)
            return fill

        return [
            ("R1", n["deA"], stage, date_vs("on or before", "the current date"),
             lambda r: f"d2:hasValue({r[ids['deA']]}) && d2:daysBetween({r[ids['deA']]}, V{{current_date}}) < 0"),
            ("R7", n["deA"], stage, fixed("after", "2000-01-01"),
             lambda r: f"d2:hasValue({r[ids['deA']]}) && d2:daysBetween({r[ids['deA']]}, '2000-01-01') >= 0"),
            ("R2", n["deB"], stage, within("within ... after", 7, "days", n["deA"]),
             lambda r: (f"d2:hasValue({r[ids['deB']]}) && d2:hasValue({r[ids['deA']]}) && "
                        f"(d2:daysBetween({r[ids['deA']]}, {r[ids['deB']]}) < 0 || "
                        f"d2:daysBetween({r[ids['deA']]}, d2:addDays({r[ids['deB']]}, -1)) >= 7 || "
                        f"d2:daysBetween(d2:addDays({r[ids['deA']]}, 1), {r[ids['deB']]}) >= 7)")),
            ("R3", "Visit date (event date)", stage, other_date("on or after", enrollment),
             lambda r: ("d2:hasValue(V{event_date}) && d2:hasValue(V{enrollment_date}) && "
                        "d2:daysBetween(V{event_date}, V{enrollment_date}) > 0")),
            ("R4", n["deN"], stage, numeric_between(35, 42),
             lambda r: f"d2:hasValue({r[ids['deN']]}) && ({r[ids['deN']]} < 35 || {r[ids['deN']]} > 42)"),
            ("R5", n["deM"], stage, numeric_vs_field("less than", n["deN"]),
             lambda r: (f"d2:hasValue({r[ids['deM']]}) && d2:hasValue({r[ids['deN']]}) && "
                        f"{r[ids['deM']]} >= {r[ids['deN']]}")),
            ("R6", n["teaT"], None, within("within ... before", 1, "months", enrollment),
             lambda r: (f"d2:hasValue({r[ids['teaT']]}) && d2:hasValue(V{{enrollment_date}}) && "
                        f"(d2:monthsBetween(d2:addDays({r[ids['teaT']]}, 1), V{{enrollment_date}}) >= 1 || "
                        f"d2:daysBetween({r[ids['teaT']]}, V{{enrollment_date}}) < 0)")),
            ("R8", enrollment, None, date_vs("on or before", "the current date"),
             lambda r: "d2:hasValue(V{enrollment_date}) && d2:daysBetween(V{enrollment_date}, V{current_date}) < 0"),
        ]

    def create_matrix_rule(self, spec):
        key, name, stage, fill, expected = spec
        program = self.ids["prog"]

        def action():
            self.open_variable(name, stage)
            rule = self.create_and_read_back(program, fill)
            self.state["rules"][key] = {"id": rule["id"], "message": rule["programRuleActions"][0]["content"]}
            want = expected(self.refs(program))
            if rule["condition"] != want:
                return False, f"condition {rule['condition']!r}, expected {want!r}"
            return True, ""
        return self.step(f"ui-create-{key}", action)

    def edit_rule(self, key, change, verify):
        """Edit a matrix rule in the form; the condition must not change."""
        def action():
            rule_id = self.state["rules"][key]["id"]
            before = get(f"/programRules/{rule_id}?fields=condition")["condition"]
            card = self.root.locator("div").filter(has_text=rule_id).filter(
                has=self.root.get_by_role("button", name="Edit", exact=True)).last
            card.get_by_role("button", name="Edit", exact=True).click()
            self.root.get_by_text("Edit program rule").wait_for(timeout=10000)
            change()
            self.root.get_by_role("button", name=UPDATE).click()
            wait_alert(self.root, "updated successfully")
            rule = get(f"/programRules/{rule_id}?fields=condition,programRuleActions[programRuleActionType,content]")
            actions = rule["programRuleActions"]
            if rule["condition"] != before or len(actions) != 1:
                return False, f"condition or actions changed: {json.dumps(rule)}"
            self.state["rules"][key]["message"] = actions[0]["content"]
            return verify(actions[0])
        return action

    def edit_r5_to_warning(self):
        self.open_variable(self.names["deM"], self.names["stage"])
        change = lambda: choose(self.root, "Error — block save", "Warning — allow save")
        verify = lambda a: (a["programRuleActionType"] == "SHOWWARNING", a["programRuleActionType"])
        return self.edit_rule("R5", change, verify)()

    def edit_r8_message(self):
        # A message tied to no field: on 2.42 this takes the JSON-patch fallback (FIXES.md).
        self.open_variable("Enrollment date (enrollment date)")
        change = lambda: self.root.get_by_placeholder(MESSAGE_PLACEHOLDER).fill(CUSTOM_R8_MESSAGE)
        verify = lambda a: (a["content"] == CUSTOM_R8_MESSAGE and a["programRuleActionType"] == "SHOWERROR",
                            json.dumps(a))
        return self.edit_rule("R8", change, verify)()

    def batch_apply(self):
        """Every date but Date C has a rule by now (due dates are never bulk-validated)."""
        program = self.ids["prog"]
        self.back_to_overview()
        card = self.root.locator(CARD).filter(has_text=OVERVIEW_MARKER).first
        choose(card, RELATIONSHIP, "before", root=self.root)
        card.locator("input[type='date']").fill("2030-01-01")
        card.get_by_text("Any unvalidated date should be before 2030-01-01").wait_for(timeout=5000)
        card.get_by_role("button", name="Add to bulk queue").click()
        wait_alert(self.root, "added to the queue")
        card.get_by_role("button", name="Apply queued rules").click()
        alert = wait_alert(self.root, "validation rule", timeout=90000)
        batch = [r for r in self.app_rules(program) if "[DVT-BATCH]" in r["description"]]
        ref_c = self.refs(program).get(self.ids["deC"], "#{?}")
        want = f"d2:hasValue({ref_c}) && d2:daysBetween({ref_c}, '2030-01-01') <= 0"
        ok = len(batch) == 1 and batch[0]["condition"] == want
        return ok, "" if ok else f"{[r['condition'] for r in batch]} (alert {alert!r}), expected [{want!r}]"

    def cleanup_offer(self):
        """A specific rule on Date C offers to remove its bulk rule."""
        program = self.ids["prog"]
        self.open_variable(self.names["deC"], self.names["stage"])
        choose(self.root, RELATIONSHIP, "on or before")
        choose(self.root, TARGET_MODE, "the current date")
        self.root.get_by_role("button", name=CREATE).click()
        modal = self.root.locator(MODAL).filter(has_text="Remove batch rules")
        modal.wait_for(timeout=30000)
        modal.get_by_role("button", name="Remove batch rules").click()
        wait_alert(self.root, "Deleted 1 rule")
        batch = [r for r in self.app_rules(program) if "[DVT-BATCH]" in r["description"]]
        return not batch, f"{len(batch)} bulk rules left" if batch else ""

    def delete_rule(self):
        """Delete the Date C rule from the details page."""
        program = self.ids["prog"]
        before = len(self.app_rules(program))
        self.root.get_by_role("button", name="Delete", exact=True).first.click()
        modal = self.root.locator(MODAL).filter(has_text="Delete validation rule")
        modal.wait_for(timeout=10000)
        modal.get_by_role("button", name="Delete", exact=True).click()
        wait_alert(self.root, "deleted successfully")
        after = len(self.app_rules(program))
        return after == before - 1, f"{before} -> {after}"

    def rule_count_tags(self):
        self.back_to_overview()
        self.root.get_by_role("heading", name=self.names["stage"], exact=True).first.click()
        self.root.get_by_text("2 rules", exact=True).first.wait_for(timeout=10000)
        return True, ""

    def run_tracker(self):
        self.open_app()
        self.step("ui-load", lambda: (self.root.get_by_text("Select a programme").first.is_visible(), ""))
        if not self.step("ui-select-program", lambda: self.select_program(self.names["prog"])):
            return False
        self.step("ui-settings", lambda: self.configure_settings(self.ids["prog"]))
        self.state["rules"] = {}
        created = [self.create_matrix_rule(spec) for spec in self.matrix_specs()]
        self.step("ui-edit-action-type", self.edit_r5_to_warning)
        self.step("ui-edit-message-no-field", self.edit_r8_message)
        self.step("ui-bulk-apply", self.batch_apply)
        self.step("ui-bulk-cleanup-offer", self.cleanup_offer)
        self.step("ui-delete-rule", self.delete_rule)
        self.step("ui-rule-count-tags", self.rule_count_tags)
        return all(created)

    # ---- event programme ----

    def event_no_enrollment_dates(self):
        body = self.root.locator("body").inner_text()
        offending = [t for t in ("(enrollment date)", "(incident date)") if t in body]
        return not offending, f"found {offending}" if offending else ""

    def event_create_rule(self):
        program = self.ids["eventProg"]
        self.open_variable(self.names["deE"], self.names["eventStage"])

        def fill():
            choose(self.root, RELATIONSHIP, "after")
            choose(self.root, TARGET_MODE, "a fixed date")
            self.root.locator("input[type='date']").first.fill("2000-01-01")
        rule = self.create_and_read_back(program, fill)
        ref = self.refs(program).get(self.ids["deE"], "#{?}")
        want = f"d2:hasValue({ref}) && d2:daysBetween({ref}, '2000-01-01') >= 0"
        # one stage: the name needs no stage to tell rules apart
        ok = rule["condition"] == want and self.names["eventStage"] not in rule["name"]
        return ok, "" if ok else f"{rule['name']!r}: {rule['condition']!r}, expected {want!r}"

    def run_event_program(self):
        self.open_app()
        if not self.step("ui-event-select-program",
                         lambda: self.select_program(f"{self.names['eventProg']} (event programme)")):
            return
        self.step("ui-event-settings", lambda: self.configure_settings(self.ids["eventProg"]))
        self.step("ui-event-no-enrollment-dates", self.event_no_enrollment_dates)
        self.step("ui-event-create-rule", self.event_create_rule)

    def check_console(self):
        real = [e for e in self.console_errors if not any(b in e for b in BENIGN_CONSOLE)]
        self.results.add("ui-no-console-errors", not real, "; ".join(e[:200] for e in real[:5]))


def run(browser, results, state, app_url, shots_dir):
    """Returns True when every matrix rule was created, which the Capture checks need."""
    page = browser.new_context(viewport={"width": 1400, "height": 1000}).new_page()
    ui = ToolUi(page, results, state, app_url, shots_dir)
    name, value = session_cookie()
    page.context.add_cookies([{"name": name, "value": value, "domain": urlparse(BASE).hostname, "path": "/"}])
    try:
        rules_ok = ui.run_tracker()
        ui.run_event_program()
        ui.check_console()
    finally:
        page.context.close()
    return rules_ok
