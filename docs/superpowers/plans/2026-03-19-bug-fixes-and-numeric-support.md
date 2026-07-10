# Tracker Validation Tool — Bug Fixes + Numeric Variable Support

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 5 critical bugs that break core date validation functionality, add support for numeric data elements and TEAs, and rename the app to "Tracker Validation Tool".

**Architecture:** All variable objects (date and numeric) are managed by a renamed `variables.js` with a unified shape including `category: "date"|"numeric"` and `valueType`. The details form branches on `category` to show date-specific or numeric-specific UI. All condition builders add `d2:hasValue()` null guards for PRV-based variables. A Vitest test suite covers all pure business logic functions.

**Tech Stack:** Vanilla JS (ES modules), Webpack 5, Materialize CSS, DHIS2 Web API. Vitest for unit tests.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/js/variables.js` | **Create** (rename from `date-variables.js`) | All trackable variables: date + numeric, for both stages and TEAs |
| `src/js/date-variables.js` | **Delete** | Replaced by variables.js |
| `src/js/rules/builder.js` | **Modify** | Add numeric builders, add null guards to date builders |
| `src/js/rules/detector.js` | **Modify** | Add numeric rule detection; remove legacy dual-type checks |
| `src/js/rules/signature.js` | **Modify** | Fix within_before/after direction; add numeric condition parsing; strip null guards when parsing |
| `src/js/services/program.js` | **Modify** | Fix progSetConfig: PUT → try/catch POST fallback |
| `src/js/services/rules.js` | **Modify** | Pass `valueType` through to PRV creation (not hardcoded "DATE") |
| `src/js/ui/overview.js` | **Modify** | Fix TEA/DE type strings; render numeric variables with teal badge |
| `src/js/ui/details.js` | **Modify** | Fix 3 prefix bugs; add action type; numeric form; null guards; Promise.all for PRV calls |
| `src/index.html` | **Modify** | Add actionType select; add numeric form elements; rename title |
| `src/css/style.css` | **Modify** | Add `.variable-badge` classes for date/numeric colour coding |
| `src/app.js` | **Modify** | Update import from date-variables → variables; pass targetVariable to parseRuleCondition in editValidation |
| `package.json` | **Modify** | Add `vitest` devDependency; add `"test"` script |
| `tests/variables.test.js` | **Create** | Unit tests for buildVariablesArray |
| `tests/builder.test.js` | **Create** | Unit tests for all condition generators |
| `tests/signature.test.js` | **Create** | Unit tests for parseRuleCondition (date + numeric + direction) |
| `tests/detector.test.js` | **Create** | Unit tests for prGetExisting with mock metadata |

---

## Task 1: Add Vitest test runner

**Files:**
- Modify: `package.json`
- Create: `vitest.config.js`

No test framework currently exists. Vitest runs ES modules natively without a bundler — ideal for testing the pure logic functions.

- [ ] **Step 1: Install vitest**

```bash
yarn add -D vitest
```

- [ ] **Step 2: Add test script to package.json**

In `package.json` scripts section, add:
```json
"test": "vitest run"
```

- [ ] **Step 3: Create vitest.config.js**

```js
// vitest.config.js
import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "node",
        globals: true
    }
});
```

- [ ] **Step 4: Verify test runner works**

```bash
yarn test
```
Expected: "No test files found" (no tests yet — that's fine, just confirms the runner is set up).

---

## Task 2: Fix variable ID/type unification (A1)

**Files:**
- Modify: `src/js/date-variables.js:23`
- Modify: `src/js/ui/overview.js:52,69`
- Create: `tests/variables.test.js` (initial version)

The canonical source of truth for variable shape is `date-variables.js`. `overview.js` must produce identical objects when it builds the `data-variable` payload stored on DOM elements. Currently they diverge on `event_date` id (`stage.id` vs `"event_date_"+stage.id`) and TEA type (`"trackedEntityAttribute"` vs `"attribute"`) and data element type (`"dataElement"` vs `"data_element"`).

Fix strategy: make **both files** use the same canonical strings:
- event_date `id`: `"event_date_" + stage.id`
- TEA `type`: `"trackedEntityAttribute"`
- Stage data element `type`: `"dataElement"`

- [ ] **Step 1: Write failing test**

Create `tests/variables.test.js`:

```js
import { buildDateVariablesArray } from "../src/js/date-variables.js";
import { vi } from "vitest";
import { setState } from "../src/js/state.js";

vi.mock("../src/js/state.js", () => {
    let _state = {};
    return {
        getState: () => _state,
        setState: (patch) => { _state = { ..._state, ...patch }; }
    };
});

const mockMeta = {
    enrollmentDateLabel: "Registration date",
    displayIncidentDate: false,
    programStages: [
        {
            id: "stage001AAAAA",
            executionDateLabel: "Event date",
            hideDueDate: false,
            programStageDataElements: [
                { dataElement: { id: "deDate01AAAA", name: "Date of birth", valueType: "DATE" } }
            ]
        }
    ],
    programTrackedEntityAttributes: [
        { trackedEntityAttribute: { id: "teaDate01AAA", name: "DOB", valueType: "DATE" } }
    ]
};

describe("buildDateVariablesArray", () => {
    beforeEach(() => {
        setState({ programMetadata: mockMeta });
    });

    it("event_date id uses 'event_date_' prefix", () => {
        const vars = buildDateVariablesArray();
        const ev = vars.find(v => v.type === "event_date");
        expect(ev.id).toBe("event_date_stage001AAAAA");
    });

    it("TEA type is 'trackedEntityAttribute'", () => {
        const vars = buildDateVariablesArray();
        const tea = vars.find(v => v.id === "teaDate01AAA");
        expect(tea.type).toBe("trackedEntityAttribute");
    });

    it("stage data element type is 'dataElement'", () => {
        const vars = buildDateVariablesArray();
        const de = vars.find(v => v.id === "deDate01AAAA");
        expect(de.type).toBe("dataElement");
    });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
yarn test tests/variables.test.js
```
Expected: FAIL — event_date id is `"stage001AAAAA"` not `"event_date_stage001AAAAA"`.

- [ ] **Step 3: Fix date-variables.js event_date id**

In `src/js/date-variables.js` line 23, change:
```js
// BEFORE
list.push({ id: stage.id, name: `${eventLabel} (event date)`, type: "event_date", stageId: stage.id });
// AFTER
list.push({ id: `event_date_${stage.id}`, name: `${eventLabel} (event date)`, type: "event_date", stageId: stage.id });
```

- [ ] **Step 4: Fix overview.js type strings**

In `src/js/ui/overview.js`:

Line 52 — TEA type:
```js
// BEFORE
enrollmentDates.push({ name: pTea.trackedEntityAttribute.name, type: "attribute", id: pTea.trackedEntityAttribute.id });
// AFTER
enrollmentDates.push({ name: pTea.trackedEntityAttribute.name, type: "trackedEntityAttribute", id: pTea.trackedEntityAttribute.id });
```

Line 69 — stage data element type:
```js
// BEFORE
dateElements.push({ name: psde.dataElement.name, type: "data_element", id: psde.dataElement.id, stageId: stage.id });
// AFTER
dateElements.push({ name: psde.dataElement.name, type: "dataElement", id: psde.dataElement.id, stageId: stage.id });
```

- [ ] **Step 5: Run tests — all pass**

```bash
yarn test tests/variables.test.js
```
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/js/date-variables.js src/js/ui/overview.js tests/variables.test.js package.json vitest.config.js
git commit -m "fix: unify variable ID/type naming between date-variables and overview

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 3: Add due_date variables (A2)

**Files:**
- Modify: `src/js/date-variables.js:21-29`
- Modify: `tests/variables.test.js` (extend)

Due dates appear in `overview.js` but are never added to the central `dateVariables` array, so clicking them fails silently.

- [ ] **Step 1: Add failing test to tests/variables.test.js**

Add to the `describe` block:
```js
it("due_date added for stages where hideDueDate is false", () => {
    const vars = buildDateVariablesArray();
    const due = vars.find(v => v.type === "due_date");
    expect(due).toBeDefined();
    expect(due.id).toBe("due_date_stage001AAAAA");
    expect(due.stageId).toBe("stage001AAAAA");
});

it("due_date NOT added for stages where hideDueDate is true", () => {
    setState({ programMetadata: { ...mockMeta, programStages: [{ ...mockMeta.programStages[0], hideDueDate: true }] } });
    const vars = buildDateVariablesArray();
    const due = vars.find(v => v.type === "due_date");
    expect(due).toBeUndefined();
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
yarn test tests/variables.test.js
```
Expected: FAIL — no due_date entry found.

- [ ] **Step 3: Add due_date to date-variables.js**

After the event_date push (line 23), add:
```js
if (!stage.hideDueDate) {
    list.push({ id: `due_date_${stage.id}`, name: "Due date", type: "due_date", stageId: stage.id });
}
```

- [ ] **Step 4: Run tests — all pass**

```bash
yarn test tests/variables.test.js
```
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/js/date-variables.js tests/variables.test.js
git commit -m "fix: add due_date entries to date variables array

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 4: Fix wrong prefix config properties (A3)

**Files:**
- Modify: `src/js/ui/details.js:324,398,406`

Three lines in `details.js` reference wrong config property names:
1. Line 324: `getConfig()?.programRuleVariablePrefix` used as rule *name* prefix — should be `programRulePrefix`
2. Line 398: `getConfig().programRuleVariablePrefix.replace(/-/g, "_").toUpperCase()` — transformation already done inside `services/rules.js`; this causes double-transformation. Should just pass the raw prefix.
3. Line 406: `getConfig()?.programRuleNamePrefix` — property doesn't exist. Should be `programRulePrefix`.

- [ ] **Step 1: Fix line 324 in addValidationCtx**

```js
// BEFORE (line 324)
const prefix = getConfig()?.programRuleVariablePrefix || "";
// AFTER
const prefix = getConfig()?.programRulePrefix || "";
```

- [ ] **Step 2: Fix lines 398 and 406 in updateValidationCtx**

```js
// BEFORE (line 398)
const variablePrefix = getConfig()?.programRuleVariablePrefix ? getConfig().programRuleVariablePrefix.replace(/-/g, "_").toUpperCase() : "";
// AFTER
const variablePrefix = getConfig()?.programRuleVariablePrefix || "";

// BEFORE (line 406)
let ruleName = getConfig()?.programRuleNamePrefix ? `${getConfig().programRuleNamePrefix} - ${actualName}` : actualName;
// AFTER
let ruleName = getConfig()?.programRulePrefix ? `${getConfig().programRulePrefix} - ${actualName}` : actualName;
```

- [ ] **Step 3: Verify with lint**

```bash
yarn lint
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/js/ui/details.js
git commit -m "fix: use correct config property names for program rule prefix

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 5: Fix dataStore save for new programs (A4)

**Files:**
- Modify: `src/js/services/program.js:34-38`
- Modify: `src/js/services/program.js:1` (add d2PostJson import)

DHIS2 dataStore requires POST to create a key for the first time; PUT only works for existing keys. `progSetConfig` always uses PUT, causing first-time saves to fail with a 404.

- [ ] **Step 1: Update import in program.js**

```js
// BEFORE
import { d2Get, d2PutJson } from "../d2api.js";
// AFTER
import { d2Get, d2PutJson, d2PostJson } from "../d2api.js";
```

- [ ] **Step 2: Fix progSetConfig to try PUT then POST**

```js
export async function progSetConfig(programId, config) {
    const ns = "tracker-date-validation";
    const key = `config-${programId}`;
    try {
        await d2PutJson(`/api/dataStore/${ns}/${key}`, config);
    } catch {
        // Key does not exist yet — create with POST
        await d2PostJson(`/api/dataStore/${ns}/${key}`, config);
    }
    return config;
}
```

- [ ] **Step 3: Lint check**

```bash
yarn lint
```

- [ ] **Step 4: Commit**

```bash
git add src/js/services/program.js
git commit -m "fix: fall back to POST when dataStore key does not exist yet

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 6: Fix interval direction parsing (A5)

**Files:**
- Modify: `src/js/rules/signature.js:101-165`
- Modify: `src/app.js:185` (pass targetVariable to parseRuleCondition)
- Create: `tests/signature.test.js`

`parseRuleCondition` always returns `operator: "within_after"` for interval rules regardless of the actual direction. Fix by accepting an optional `targetVariable` parameter and using argument order to determine direction:
- `d2:*Between(compareRef, targetRef)` → `within_before` (compare is first arg)
- `d2:*Between(targetRef, compareRef)` → `within_after` (target is first arg)

- [ ] **Step 1: Write failing test**

Create `tests/signature.test.js`:

```js
import { parseRuleCondition } from "../src/js/rules/signature.js";

const mockMeta = {
    programRuleVariables: [
        {
            name: "EIR_VACCINATION_DATE",
            dataElement: { id: "deVacc01AAAA" },
            programStage: { id: "stage001AAAAA" }
        },
        {
            name: "EIR_DOB",
            trackedEntityAttribute: { id: "teaDob01AAAA" }
        }
    ]
};

const targetVacc = { type: "dataElement", id: "deVacc01AAAA", stageId: "stage001AAAAA" };

describe("parseRuleCondition — date comparisons", () => {
    it("parses before (daysBetween < 0)", () => {
        const result = parseRuleCondition("d2:daysBetween(V{event_date}, V{enrollment_date}) < 0", mockMeta);
        expect(result.config.operator).toBe("before");
    });

    it("parses on_or_after (daysBetween >= 0)", () => {
        const result = parseRuleCondition("d2:daysBetween(V{event_date}, V{enrollment_date}) >= 0", mockMeta);
        expect(result.config.operator).toBe("on_or_after");
    });
});

describe("parseRuleCondition — interval direction", () => {
    it("detects within_after when target is first arg", () => {
        // within_after: d2:*Between(targetRef, compareRef)
        const condition = "d2:daysBetween(#{EIR_VACCINATION_DATE}, V{enrollment_date}) > 30";
        const result = parseRuleCondition(condition, mockMeta, targetVacc);
        expect(result.config.operator).toBe("within_after");
        expect(result.config.intervalAmount).toBe(30);
        expect(result.config.intervalUnit).toBe("days");
    });

    it("detects within_before when target is second arg", () => {
        // within_before: d2:*Between(compareRef, targetRef)
        const condition = "d2:daysBetween(V{enrollment_date}, #{EIR_VACCINATION_DATE}) > 30";
        const result = parseRuleCondition(condition, mockMeta, targetVacc);
        expect(result.config.operator).toBe("within_before");
    });

    it("defaults to within_after when no targetVariable given", () => {
        const condition = "d2:daysBetween(V{enrollment_date}, #{EIR_VACCINATION_DATE}) > 30";
        const result = parseRuleCondition(condition, mockMeta);
        expect(result.config.operator).toBe("within_after");
    });
});
```

- [ ] **Step 2: Run tests — confirm failure**

```bash
yarn test tests/signature.test.js
```
Expected: interval direction tests FAIL.

- [ ] **Step 3: Update parseRuleCondition signature and interval branch**

In `src/js/rules/signature.js`, change the function signature:
```js
// BEFORE
export function parseRuleCondition(condition, programMetadata) {
// AFTER
export function parseRuleCondition(condition, programMetadata, targetVariable = null) {
```

Replace the interval parsing block (lines ~138-162):
```js
const intervalMatch = condition.match(/d2:(days|weeks|months|years)Between\(([^,]+),\s*([^)]+)\)\s*>\s*(\d+)/);
if (intervalMatch) {
    const [, unit, ref1, ref2, amount] = intervalMatch;
    const var1Ref = ref1.trim().replace(/^V\{|\}$/g, "");
    const var2Ref = ref2.trim().replace(/^V\{|\}$/g, "");
    const parsedRef1 = parseVariableReference(var1Ref, programMetadata);
    const parsedRef2 = parseVariableReference(var2Ref, programMetadata);
    if (!parsedRef1 || !parsedRef2) return null;

    // Determine direction using targetVariable context:
    // within_after:  d2:*Between(targetRef, compareRef) — target is ref1 (first arg)
    // within_before: d2:*Between(compareRef, targetRef) — target is ref2 (second arg)
    let operator = "within_after"; // default (no context)
    let variable1 = parsedRef1; // target (validated date)
    let variable2 = parsedRef2; // comparison date

    if (targetVariable) {
        const ref2IsTarget = parsedRef2.id === targetVariable.id && parsedRef2.type === targetVariable.type;
        if (ref2IsTarget) {
            operator = "within_before";
            variable1 = parsedRef2; // swap: return target first
            variable2 = parsedRef1;
        }
    }

    return {
        variable1,
        variable2,
        config: { operator, intervalAmount: parseInt(amount), intervalUnit: unit }
    };
}
```

- [ ] **Step 4: Pass targetVariable in app.js editValidation**

In `src/app.js` at line 185:
```js
// BEFORE
const ruleConfig = parseRuleCondition(rule.condition, programMetadata);
// AFTER
const ruleConfig = parseRuleCondition(rule.condition, programMetadata, currentVariable);
```

- [ ] **Step 5: Pass targetVariable in findDuplicateRule**

In `src/js/rules/signature.js`, `findDuplicateRule` calls `parseRuleCondition`. Pass `variable` (already available) as the third arg:
```js
// BEFORE
const ruleConfig = parseRuleCondition(rule.condition, programMetadata);
// AFTER
const ruleConfig = parseRuleCondition(rule.condition, programMetadata, variable);
```

- [ ] **Step 6: Run tests — all pass**

```bash
yarn test tests/signature.test.js
```
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add src/js/rules/signature.js src/app.js tests/signature.test.js
git commit -m "fix: detect within_before vs within_after from interval condition argument order

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 7: Add action type selector (B1)

**Files:**
- Modify: `src/index.html` (inside `#newValidationForm`)
- Modify: `src/js/ui/details.js` (addValidationCtx, updateValidationCtx, setupValidationFormCtx, loadCurrentValidationsCtx)

Currently hardcoded to `SHOWERROR`. The user must be able to choose from all 4 action types, defaulting to `SHOWERROR`.

- [ ] **Step 1: Add action type select to index.html**

Insert a new row in `#newValidationForm` after the `ruleMessage` row (before the submit button row):

```html
<div class="row">
    <div class="input-field col s12 m6">
        <select id="actionType">
            <option value="SHOWERROR" selected>Show Error (blocks save)</option>
            <option value="SHOWWARNING">Show Warning (non-blocking)</option>
            <option value="ERRORONCOMPLETE">Error on Complete</option>
            <option value="WARNINGONCOMPLETE">Warning on Complete</option>
        </select>
        <label>Action Type</label>
    </div>
</div>
```

- [ ] **Step 2: Reset actionType in setupValidationFormCtx**

In `src/js/ui/details.js`, in `setupValidationFormCtx`, add after the existing field resets:
```js
document.getElementById("actionType").value = "SHOWERROR";
```

- [ ] **Step 3: Include actionType in createValidationRuleCtx**

In `createValidationRuleCtx`:
```js
// Add to validationConfig object:
const actionType = document.getElementById("actionType").value || "SHOWERROR";
const validationConfig = { operator, comparisonDate, intervalAmount: ..., intervalUnit, ruleName, ruleDescription, ruleMessage, actionType };
```

- [ ] **Step 4: Use actionType in addValidationCtx**

Replace the hardcoded `"SHOWERROR"`:
```js
// BEFORE
const programRuleAction = { programRuleActionType: "SHOWERROR", content: config.ruleMessage, ... };
// AFTER
const programRuleAction = { programRuleActionType: config.actionType || "SHOWERROR", content: config.ruleMessage, ... };
```

- [ ] **Step 5: Use actionType in updateValidationCtx**

The existing action's type is already preserved via `...existingAction`. Add update for action type:
```js
const updatedAction = {
    ...existingAction,
    programRuleActionType: config.actionType || existingAction.programRuleActionType,
    content: config.ruleMessage
};
```

- [ ] **Step 6: Pre-populate actionType when editing**

In `src/app.js` `window.editValidation`, after populating other form fields:
```js
document.getElementById("actionType").value = action.programRuleActionType || "SHOWERROR";
```

- [ ] **Step 7: Re-init Materialize selects** (already done in setupValidationFormCtx — verify it includes actionType).

- [ ] **Step 8: Lint + visual smoke test**

```bash
yarn lint
```
Open app at http://localhost:8081, select a programme, open details page, verify dropdown appears with "Show Error" selected.

- [ ] **Step 9: Commit**

```bash
git add src/index.html src/js/ui/details.js src/app.js
git commit -m "feat: add action type selector to validation form (default: Show Error)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 8: Add d2:hasValue() null guards (B2)

**Files:**
- Modify: `src/js/rules/builder.js`
- Modify: `src/js/rules/signature.js` (strip guard when parsing)
- Modify: `tests/builder.test.js` (create)
- Modify: `tests/signature.test.js` (extend)

Currently generated conditions have no null check, causing rules to fire even when the validated field is empty. System variables (enrollment_date, event_date, etc.) are always set — no guard needed for those. PRV-based variables (dataElement, trackedEntityAttribute) need: `d2:hasValue(#{VAR}) && <condition>`.

- [ ] **Step 1: Write failing tests for builder**

Create `tests/builder.test.js`:

```js
import { generateNewRuleCondition, getVariableReference, isSystemVariable } from "../src/js/rules/builder.js";

const enrollment = { type: "enrollment", id: "enrollment_date" };
const eventDate = { type: "event_date", id: "event_date_stg01", stageId: "stg01" };
const dateDE = { type: "dataElement", id: "deAbc", stageId: "stg01", prvName: "EIR_DE_DATE" };
const dateTEA = { type: "trackedEntityAttribute", id: "teaAbc", prvName: "EIR_TEA_DATE" };

describe("generateNewRuleCondition — null guards", () => {
    it("adds d2:hasValue guard for dataElement variable", () => {
        const condition = generateNewRuleCondition(dateDE, enrollment, { operator: "before" });
        expect(condition).toContain("d2:hasValue(#{EIR_DE_DATE})");
        expect(condition).toContain("d2:daysBetween");
    });

    it("adds d2:hasValue guard for trackedEntityAttribute variable", () => {
        const condition = generateNewRuleCondition(dateTEA, enrollment, { operator: "after" });
        expect(condition).toContain("d2:hasValue(#{EIR_TEA_DATE})");
    });

    it("does NOT add guard for enrollment_date (system variable)", () => {
        const condition = generateNewRuleCondition(enrollment, eventDate, { operator: "before" });
        expect(condition).not.toContain("d2:hasValue");
    });

    it("does NOT add guard for event_date (system variable)", () => {
        const condition = generateNewRuleCondition(eventDate, enrollment, { operator: "after" });
        expect(condition).not.toContain("d2:hasValue");
    });
});

describe("isSystemVariable", () => {
    it("returns true for enrollment", () => expect(isSystemVariable(enrollment)).toBe(true));
    it("returns true for event_date", () => expect(isSystemVariable(eventDate)).toBe(true));
    it("returns false for dataElement", () => expect(isSystemVariable(dateDE)).toBe(false));
    it("returns false for trackedEntityAttribute", () => expect(isSystemVariable(dateTEA)).toBe(false));
});
```

- [ ] **Step 2: Run tests — confirm failures**

```bash
yarn test tests/builder.test.js
```
Expected: null guard tests FAIL.

- [ ] **Step 3: Update builder.js to add null guards**

In `src/js/rules/builder.js`, add `isSystemVariable`, a helper, and update `generateNewRuleCondition`:

```js
const SYSTEM_VARIABLE_TYPES = new Set(["enrollment", "incident", "event_date", "due_date", "current_date"]);

export function isSystemVariable(variable) {
    return SYSTEM_VARIABLE_TYPES.has(variable.type);
}

function buildNullGuard(variable) {
    if (isSystemVariable(variable)) return null;
    const ref = getVariableReference(variable);
    return `d2:hasValue(${ref})`;
}

export function generateNewRuleCondition(variable1, variable2, config) {
    const var1Ref = getVariableReference(variable1);
    const var2Ref = getVariableReference(variable2);
    const guard = buildNullGuard(variable1);

    let condition;
    switch (config.operator) {
    case "before": condition = `d2:daysBetween(${var1Ref}, ${var2Ref}) < 0`; break;
    case "after": condition = `d2:daysBetween(${var1Ref}, ${var2Ref}) > 0`; break;
    case "on_or_after": condition = `d2:daysBetween(${var1Ref}, ${var2Ref}) >= 0`; break;
    case "on_or_before": condition = `d2:daysBetween(${var1Ref}, ${var2Ref}) <= 0`; break;
    case "within_before": condition = generateIntervalCondition(var2Ref, var1Ref, config.intervalAmount, config.intervalUnit); break;
    case "within_after": condition = generateIntervalCondition(var1Ref, var2Ref, config.intervalAmount, config.intervalUnit); break;
    default: throw new Error(`Unknown operator: ${config.operator}`);
    }

    return guard ? `${guard} && ${condition}` : condition;
}
```

- [ ] **Step 4: Update parseRuleCondition to strip null guards**

In `src/js/rules/signature.js`, at the top of `parseRuleCondition`:
```js
export function parseRuleCondition(condition, programMetadata, targetVariable = null) {
    // Strip leading d2:hasValue() guard before parsing
    const strippedCondition = condition.replace(/^d2:hasValue\([^)]+\)\s*&&\s*/, "");
    condition = strippedCondition;
    // ... rest of function unchanged
```

- [ ] **Step 5: Add test for parsing conditions with null guard**

Add to `tests/signature.test.js`:
```js
it("parses condition with leading d2:hasValue guard", () => {
    const condition = "d2:hasValue(#{EIR_VACCINATION_DATE}) && d2:daysBetween(#{EIR_VACCINATION_DATE}, V{enrollment_date}) < 0";
    const result = parseRuleCondition(condition, mockMeta);
    expect(result).not.toBeNull();
    expect(result.config.operator).toBe("before");
});
```

- [ ] **Step 6: Run all tests**

```bash
yarn test
```
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/js/rules/builder.js src/js/rules/signature.js tests/builder.test.js tests/signature.test.js
git commit -m "feat: add d2:hasValue() null guards to generated conditions; strip guards when parsing

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 9: Remove redundant [DVT] double-prefix (B3)

**Files:**
- Modify: `src/js/ui/details.js:332-334`

`addAppSignature` already handles the `[DVT]` prefix. The manual check before calling it is redundant.

- [ ] **Step 1: Remove redundant prefix check**

In `addValidationCtx`, replace lines 332-334:
```js
// BEFORE
let desc = config.ruleDescription || defaultDesc;
if (!desc.startsWith("[DVT]")) desc = `[DVT] ${desc}`;
const { description } = addAppSignature(ruleName, desc);

// AFTER
const { description } = addAppSignature(ruleName, config.ruleDescription || defaultDesc);
```

- [ ] **Step 2: Lint**

```bash
yarn lint
```

- [ ] **Step 3: Commit**

```bash
git add src/js/ui/details.js
git commit -m "fix: remove redundant [DVT] prefix before addAppSignature call

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 10: Extend variables to include numeric; rename file (C1)

**Files:**
- Create: `src/js/variables.js`
- Delete: `src/js/date-variables.js` (content moved)
- Modify: `src/app.js` (import path)
- Modify: `src/js/ui/details.js` (import path)
- Modify: `tests/variables.test.js` (update import + add numeric tests)

Rename `date-variables.js` → `variables.js`. Add `category` and `valueType` fields to all variables. Add numeric variables for both stage data elements and TEAs. Numeric value types: `INTEGER`, `INTEGER_POSITIVE`, `INTEGER_ZERO_OR_POSITIVE`, `INTEGER_NEGATIVE`, `NUMBER`, `PERCENTAGE`.

- [ ] **Step 1: Add failing tests for numeric variables**

Add to `tests/variables.test.js` (update import to `../src/js/variables.js`):

```js
const mockMetaWithNumeric = {
    enrollmentDateLabel: "Registration date",
    displayIncidentDate: false,
    programStages: [{
        id: "stage001AAAAA",
        executionDateLabel: "Event date",
        hideDueDate: true,
        programStageDataElements: [
            { dataElement: { id: "deInt01AAAAA", name: "Age (years)", valueType: "INTEGER" } },
            { dataElement: { id: "deNum01AAAAA", name: "Weight (kg)", valueType: "NUMBER" } },
            { dataElement: { id: "deDate01AAAA", name: "Date of birth", valueType: "DATE" } },
            { dataElement: { id: "deTxt01AAAAA", name: "Notes", valueType: "TEXT" } },
        ]
    }],
    programTrackedEntityAttributes: [
        { trackedEntityAttribute: { id: "teaInt01AAAA", name: "Age at registration", valueType: "INTEGER_POSITIVE" } },
        { trackedEntityAttribute: { id: "teaDate01AAA", name: "DOB", valueType: "DATE" } },
    ]
};

describe("buildVariablesArray — numeric variables", () => {
    beforeEach(() => setState({ programMetadata: mockMetaWithNumeric }));

    it("includes INTEGER data element with category=numeric", () => {
        const vars = buildVariablesArray();
        const v = vars.find(x => x.id === "deInt01AAAAA");
        expect(v).toBeDefined();
        expect(v.category).toBe("numeric");
        expect(v.valueType).toBe("INTEGER");
    });

    it("includes NUMBER data element with category=numeric", () => {
        const vars = buildVariablesArray();
        const v = vars.find(x => x.id === "deNum01AAAAA");
        expect(v.category).toBe("numeric");
    });

    it("includes INTEGER_POSITIVE TEA with category=numeric", () => {
        const vars = buildVariablesArray();
        const v = vars.find(x => x.id === "teaInt01AAAA");
        expect(v).toBeDefined();
        expect(v.category).toBe("numeric");
        expect(v.type).toBe("trackedEntityAttribute");
    });

    it("excludes TEXT data elements", () => {
        const vars = buildVariablesArray();
        const v = vars.find(x => x.id === "deTxt01AAAAA");
        expect(v).toBeUndefined();
    });

    it("all date variables have category=date", () => {
        const vars = buildVariablesArray();
        const dates = vars.filter(x => x.category === "date");
        expect(dates.length).toBeGreaterThan(0);
        dates.forEach(v => expect(v.valueType).toBe("DATE"));
    });
});
```

- [ ] **Step 2: Run tests — confirm failures**

```bash
yarn test tests/variables.test.js
```

- [ ] **Step 3: Create src/js/variables.js**

```js
import { getState, setState } from "./state.js";

const NUMERIC_VALUE_TYPES = new Set([
    "INTEGER", "INTEGER_POSITIVE", "INTEGER_ZERO_OR_POSITIVE",
    "INTEGER_NEGATIVE", "NUMBER", "PERCENTAGE"
]);

export function buildVariablesArray() {
    const { programMetadata } = getState();
    const list = [];
    if (!programMetadata) {
        setState({ dateVariables: list });
        return list;
    }

    if (programMetadata.enrollmentDateLabel) {
        list.push({
            id: "enrollment_date",
            name: `${programMetadata.enrollmentDateLabel} (enrollment date)`,
            type: "enrollment", category: "date", valueType: "DATE"
        });
    }
    if (programMetadata.displayIncidentDate && programMetadata.incidentDateLabel) {
        list.push({
            id: "incident_date",
            name: `${programMetadata.incidentDateLabel} (incident date)`,
            type: "incident", category: "date", valueType: "DATE"
        });
    }
    list.push({ id: "current_date", name: "Current date", type: "current_date", category: "date", valueType: "DATE" });

    programMetadata.programStages?.forEach(stage => {
        const eventLabel = stage.executionDateLabel || "Event date";
        list.push({
            id: `event_date_${stage.id}`, name: `${eventLabel} (event date)`,
            type: "event_date", category: "date", valueType: "DATE", stageId: stage.id
        });
        if (!stage.hideDueDate) {
            list.push({
                id: `due_date_${stage.id}`, name: "Due date",
                type: "due_date", category: "date", valueType: "DATE", stageId: stage.id
            });
        }
        stage.programStageDataElements?.forEach(psde => {
            const de = psde.dataElement;
            if (!de) return;
            if (de.valueType === "DATE") {
                list.push({ id: de.id, name: de.name, type: "dataElement", category: "date", valueType: "DATE", stageId: stage.id });
            } else if (NUMERIC_VALUE_TYPES.has(de.valueType)) {
                list.push({ id: de.id, name: de.name, type: "dataElement", category: "numeric", valueType: de.valueType, stageId: stage.id });
            }
        });
    });

    programMetadata.programTrackedEntityAttributes?.forEach(ptea => {
        const tea = ptea.trackedEntityAttribute;
        if (!tea) return;
        if (tea.valueType === "DATE") {
            list.push({ id: tea.id, name: tea.name, type: "trackedEntityAttribute", category: "date", valueType: "DATE" });
        } else if (NUMERIC_VALUE_TYPES.has(tea.valueType)) {
            list.push({ id: tea.id, name: tea.name, type: "trackedEntityAttribute", category: "numeric", valueType: tea.valueType });
        }
    });

    setState({ dateVariables: list });
    return list;
}

// Keep old function name as alias for gradual migration
export const buildDateVariablesArray = buildVariablesArray;

export function findDateVariable(id) {
    const { dateVariables } = getState();
    return (dateVariables || []).find(v => v.id === id);
}

export function findVariableByComponents(id, type, stageId) {
    const { dateVariables } = getState();
    if (!dateVariables) return null;
    return dateVariables.find(v => v.id === id && v.type === type && (stageId ? v.stageId === stageId : true));
}

export function findDataElementById(id) {
    const { programMetadata } = getState();
    for (const stage of (programMetadata?.programStages || [])) {
        for (const psde of (stage.programStageDataElements || [])) {
            if (psde.dataElement?.id === id) return psde.dataElement;
        }
    }
    return null;
}

export function findAttributeById(id) {
    const { programMetadata } = getState();
    for (const ptea of (programMetadata?.programTrackedEntityAttributes || [])) {
        if (ptea.trackedEntityAttribute?.id === id) return ptea.trackedEntityAttribute;
    }
    return null;
}
```

- [ ] **Step 4: Update imports in app.js and details.js**

In `src/app.js`, change:
```js
// BEFORE
import { buildDateVariablesArray as dvBuild, findDateVariableByComponents as dvFindByComponents } from "./js/date-variables.js";
// AFTER
import { buildVariablesArray as dvBuild, findVariableByComponents as dvFindByComponents } from "./js/variables.js";
```
Note: `buildDetailsCtx()` already contains `findByComponents: (id, type, stageId) => dvFindByComponents(id, type, stageId)` — no change needed there. Just ensure the import alias is updated.

In `src/js/ui/details.js`, change:
```js
// BEFORE
import { buildDateVariablesArray as dvBuild } from "../date-variables.js";
// AFTER
import { buildVariablesArray as dvBuild } from "../variables.js";
```

- [ ] **Step 5: Run all tests**

```bash
yarn test
```
Expected: all pass.

- [ ] **Step 6: Delete old file**

```bash
git rm src/js/date-variables.js
```

- [ ] **Step 7: Commit**

```bash
git add src/js/variables.js src/app.js src/js/ui/details.js tests/variables.test.js
git commit -m "feat: extend variable model for numeric fields; rename date-variables.js to variables.js

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 11: Render numeric variables in overview (C2)

**Files:**
- Modify: `src/js/ui/overview.js`
- Modify: `src/css/style.css`

Numeric variables appear mixed in with dates in each stage card and enrollment section, with a distinct teal-coloured chip/badge to distinguish them visually. Update section heading and label map.

- [ ] **Step 1: Add variable badge CSS to style.css**

```css
/* Variable type badges */
.variable-badge {
    display: inline-block;
    padding: 1px 8px;
    border-radius: 10px;
    font-size: 0.75rem;
    margin-left: 6px;
    font-weight: 500;
}
.variable-badge-date {
    background-color: #e3f2fd;
    color: #1565c0;
}
.variable-badge-numeric {
    background-color: #e0f2f1;
    color: #00695c;
}
```

- [ ] **Step 2: Update overview.js renderEnrollmentDates to include numeric TEAs**

Change the filter in `renderEnrollmentDates` from checking `valueType === "DATE"` to including numeric types:
```js
(programMetadata.programTrackedEntityAttributes || []).forEach(pTea => {
    const tea = pTea.trackedEntityAttribute;
    if (!tea) return;
    if (tea.valueType === "DATE") {
        enrollmentDates.push({ name: tea.name, type: "trackedEntityAttribute", id: tea.id, category: "date", valueType: "DATE" });
    } else if (["INTEGER","INTEGER_POSITIVE","INTEGER_ZERO_OR_POSITIVE","INTEGER_NEGATIVE","NUMBER","PERCENTAGE"].includes(tea.valueType)) {
        enrollmentDates.push({ name: tea.name, type: "trackedEntityAttribute", id: tea.id, category: "numeric", valueType: tea.valueType });
    }
});
```

- [ ] **Step 3: Update renderProgramStages to include numeric data elements**

Change the `psde` filter to also include numeric:
```js
(stage.programStageDataElements || []).forEach(psde => {
    const de = psde.dataElement;
    if (!de) return;
    if (de.valueType === "DATE") {
        dateElements.push({ name: de.name, type: "dataElement", id: de.id, stageId: stage.id, category: "date", valueType: "DATE" });
    } else if (["INTEGER","INTEGER_POSITIVE","INTEGER_ZERO_OR_POSITIVE","INTEGER_NEGATIVE","NUMBER","PERCENTAGE"].includes(de.valueType)) {
        dateElements.push({ name: de.name, type: "dataElement", id: de.id, stageId: stage.id, category: "numeric", valueType: de.valueType });
    }
});
```

- [ ] **Step 4: Update createDateVariableElement to show category badge**

```js
export function createDateVariableElement(dateVar) {
    const div = document.createElement("div");
    div.className = "date-variable";
    div.dataset.variable = JSON.stringify(dateVar);
    const badgeClass = dateVar.category === "numeric" ? "variable-badge-numeric" : "variable-badge-date";
    const badgeLabel = dateVar.category === "numeric" ? "Numeric" : "Date";
    div.innerHTML = `
        <strong>${dateVar.name}</strong>
        <span class="grey-text"> (${getVariableTypeLabel(dateVar.type)})</span>
        <span class="variable-badge ${badgeClass}">${badgeLabel}</span>`;
    div.addEventListener("click", () => {
        window.__showVariableDetails && window.__showVariableDetails(dateVar);
    });
    return div;
}
```

- [ ] **Step 5: Update getVariableTypeLabel for numeric types**

```js
function getVariableTypeLabel(type) {
    const labels = {
        enrollment: "Enrollment Date", incident: "Incident Date",
        trackedEntityAttribute: "Tracked Entity Attribute",
        event_date: "Event Date", due_date: "Due Date",
        dataElement: "Data Element"
    };
    return labels[type] || type;
}
```

- [ ] **Step 6: Update index.html heading**

```html
<!-- BEFORE -->
<h2>Date Variables</h2>
<p class="grey-text">Click on any date variable to configure validation rules.</p>
<!-- AFTER -->
<h2>Variables</h2>
<p class="grey-text">Click on any date or numeric variable to configure validation rules.</p>
```

- [ ] **Step 7: Smoke test — open app, select EIR programme**

Verify: numeric data elements and TEAs appear in the overview alongside dates, with teal "Numeric" badge.

- [ ] **Step 8: Commit**

```bash
git add src/js/ui/overview.js src/css/style.css src/index.html
git commit -m "feat: render numeric variables in overview with teal badge

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 12: Numeric condition builders (C3)

**Files:**
- Modify: `src/js/rules/builder.js`
- Modify: `tests/builder.test.js` (extend)

Add `generateNumericCondition` (variable vs fixed value) and `generateNumericFieldCondition` (variable vs another variable). Both include `d2:hasValue()` guard.

- [ ] **Step 1: Write failing tests**

Add to `tests/builder.test.js`:

```js
import { generateNumericCondition, generateNumericFieldCondition } from "../src/js/rules/builder.js";

const numDE = { type: "dataElement", id: "deAge01AAAAA", stageId: "stg01", prvName: "EIR_AGE" };
const numDE2 = { type: "dataElement", id: "deWeight01AA", stageId: "stg01", prvName: "EIR_WEIGHT" };

describe("generateNumericCondition — variable vs fixed value", () => {
    it("greater_than produces correct expression", () => {
        const c = generateNumericCondition(numDE, "greater_than", 0);
        expect(c).toBe("d2:hasValue(#{EIR_AGE}) && #{EIR_AGE} > 0");
    });
    it("less_than_or_equal produces correct expression", () => {
        const c = generateNumericCondition(numDE, "less_than_or_equal", 120);
        expect(c).toBe("d2:hasValue(#{EIR_AGE}) && #{EIR_AGE} <= 120");
    });
    it("equal_to produces == expression", () => {
        const c = generateNumericCondition(numDE, "equal_to", 5);
        expect(c).toBe("d2:hasValue(#{EIR_AGE}) && #{EIR_AGE} == 5");
    });
    it("throws on unknown operator", () => {
        expect(() => generateNumericCondition(numDE, "between", 5)).toThrow();
    });
});

describe("generateNumericFieldCondition — variable vs variable", () => {
    it("greater_than produces field comparison", () => {
        const c = generateNumericFieldCondition(numDE, "greater_than", numDE2);
        expect(c).toBe("d2:hasValue(#{EIR_AGE}) && #{EIR_AGE} > #{EIR_WEIGHT}");
    });
});
```

- [ ] **Step 2: Run tests — confirm failures**

```bash
yarn test tests/builder.test.js
```

- [ ] **Step 3: Add numeric builders to builder.js**

```js
const NUMERIC_OP_MAP = {
    "greater_than": ">",
    "greater_than_or_equal": ">=",
    "less_than": "<",
    "less_than_or_equal": "<=",
    "equal_to": "==",
    "not_equal_to": "!="
};

export function generateNumericCondition(variable, operator, value) {
    const varRef = getVariableReference(variable);
    const op = NUMERIC_OP_MAP[operator];
    if (!op) throw new Error(`Unknown numeric operator: ${operator}`);
    return `d2:hasValue(${varRef}) && ${varRef} ${op} ${value}`;
}

export function generateNumericFieldCondition(variable1, operator, variable2) {
    const var1Ref = getVariableReference(variable1);
    const var2Ref = getVariableReference(variable2);
    const op = NUMERIC_OP_MAP[operator];
    if (!op) throw new Error(`Unknown numeric operator: ${operator}`);
    return `d2:hasValue(${var1Ref}) && ${var1Ref} ${op} ${var2Ref}`;
}
```

Also update `getValidationStageId` to handle numeric:
```js
export function getValidationStageId(variable1, variable2) {
    const pick = v => (["dataElement", "data_element", "event_date", "due_date"].includes(v?.type)) ? v.stageId : null;
    return pick(variable1) || pick(variable2) || null;
}
```

- [ ] **Step 4: Run tests — all pass**

```bash
yarn test tests/builder.test.js
```

- [ ] **Step 5: Commit**

```bash
git add src/js/rules/builder.js tests/builder.test.js
git commit -m "feat: add numeric condition builders to builder.js

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 13: Numeric rule detection (C4)

**Files:**
- Modify: `src/js/rules/detector.js`
- Create: `tests/detector.test.js`

Add detection of numeric validation rules. A numeric rule is detected when the PRV-based variable is the primary subject in a `#{VAR} OP value` or `#{VAR} OP #{VAR2}` condition.

- [ ] **Step 1: Write failing tests**

Create `tests/detector.test.js`:

```js
import { prGetExisting } from "../src/js/rules/detector.js";

const numericVar = { type: "dataElement", id: "deAge01AAAAA", stageId: "stg01" };

const mockMeta = {
    programRuleVariables: [
        { name: "EIR_AGE", dataElement: { id: "deAge01AAAAA" }, programStage: { id: "stg01" } }
    ],
    programRules: [
        { id: "rule001AAAAA", condition: "d2:hasValue(#{EIR_AGE}) && #{EIR_AGE} > 0",
          programStage: { id: "stg01" } }
    ],
    programRuleActions: [
        { id: "action01AAAA", programRule: { id: "rule001AAAAA" }, programRuleActionType: "SHOWERROR" }
    ]
};

describe("prGetExisting — numeric rules", () => {
    it("detects numeric rule for a dataElement variable", () => {
        const results = prGetExisting(mockMeta, numericVar);
        expect(results.length).toBe(1);
        expect(results[0].rule.id).toBe("rule001AAAAA");
    });
});
```

- [ ] **Step 2: Run test — confirm failure**

```bash
yarn test tests/detector.test.js
```

- [ ] **Step 3: Add numeric condition detection to detector.js**

In `isVariablePrimaryTarget`, add a check for numeric conditions after the existing interval check:

```js
// Parse numeric conditions: #{VAR} OP value  or  #{VAR} OP #{VAR2}
const numericMatch = condition.match(/#{([^}]+)}\s*(>=|<=|>|<|==|!=)\s*.+/);
if (numericMatch) {
    const [, prvName] = numericMatch;
    if (type === "dataElement" || type === "trackedEntityAttribute") {
        return relatedPrvs.some(prv => prv.name === prvName);
    }
}
```

- [ ] **Step 4: Run tests**

```bash
yarn test tests/detector.test.js
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/js/rules/detector.js tests/detector.test.js
git commit -m "feat: detect numeric validation rules in detector.js

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 14: Parse numeric rule conditions (C5)

**Files:**
- Modify: `src/js/rules/signature.js`
- Modify: `tests/signature.test.js` (extend)

Update `parseRuleCondition` to handle numeric literal conditions (`#{VAR} > 5`) and numeric field-to-field conditions (`#{VAR1} > #{VAR2}`). Strip `d2:hasValue()` guard before trying all patterns.

- [ ] **Step 1: Add failing tests**

Add to `tests/signature.test.js`:

```js
describe("parseRuleCondition — numeric literal", () => {
    it("parses greater_than with fixed value", () => {
        const condition = "d2:hasValue(#{EIR_AGE}) && #{EIR_AGE} > 0";
        // Need mockMeta with EIR_AGE PRV
        const meta = { programRuleVariables: [{ name: "EIR_AGE", dataElement: { id: "deAge01AAAAA" }, programStage: { id: "stg01" } }] };
        const result = parseRuleCondition(condition, meta);
        expect(result).not.toBeNull();
        expect(result.config.operator).toBe("greater_than");
        expect(result.config.comparisonType).toBe("value");
        expect(result.config.value).toBe(0);
        expect(result.variable1.id).toBe("deAge01AAAAA");
    });
});

describe("parseRuleCondition — numeric field-to-field", () => {
    it("parses greater_than between two numeric fields", () => {
        const condition = "d2:hasValue(#{EIR_AGE}) && #{EIR_AGE} > #{EIR_WEIGHT}";
        const meta = {
            programRuleVariables: [
                { name: "EIR_AGE", dataElement: { id: "deAge01AAAAA" }, programStage: { id: "stg01" } },
                { name: "EIR_WEIGHT", dataElement: { id: "deWeight01AA" }, programStage: { id: "stg01" } }
            ]
        };
        const result = parseRuleCondition(condition, meta);
        expect(result).not.toBeNull();
        expect(result.config.operator).toBe("greater_than");
        expect(result.config.comparisonType).toBe("field");
        expect(result.variable2.id).toBe("deWeight01AA");
    });
});
```

- [ ] **Step 2: Run tests — confirm failures**

```bash
yarn test tests/signature.test.js
```

- [ ] **Step 3: Add numeric parsing to parseRuleCondition in signature.js**

Add after the existing interval match block (before `return null`):

```js
// Parse numeric field-to-field: #{VAR1} OP #{VAR2}
const numericFieldMatch = condition.match(/#{([^}]+)}\s*(>=|<=|>|<|==|!=)\s*#{([^}]+)}/);
if (numericFieldMatch) {
    const [, prvName1, op, prvName2] = numericFieldMatch;
    const variable1 = parseVariableReference(prvName1, programMetadata);
    const variable2 = parseVariableReference(prvName2, programMetadata);
    if (!variable1 || !variable2) return null;
    const operator = NUMERIC_OP_REVERSE_MAP[op] || op;
    return { variable1, variable2, config: { operator, comparisonType: "field" } };
}

// Parse numeric literal: #{VAR} OP number
const numericLiteralMatch = condition.match(/#{([^}]+)}\s*(>=|<=|>|<|==|!=)\s*(-?\d+(?:\.\d+)?)/);
if (numericLiteralMatch) {
    const [, prvName, op, rawValue] = numericLiteralMatch;
    const variable1 = parseVariableReference(prvName, programMetadata);
    if (!variable1) return null;
    const operator = NUMERIC_OP_REVERSE_MAP[op] || op;
    return { variable1, variable2: null, config: { operator, comparisonType: "value", value: parseFloat(rawValue) } };
}
```

Add the reverse map near the top of the file:
```js
const NUMERIC_OP_REVERSE_MAP = {
    ">": "greater_than", ">=": "greater_than_or_equal",
    "<": "less_than", "<=": "less_than_or_equal",
    "==": "equal_to", "!=": "not_equal_to"
};
```

- [ ] **Step 4: Run all tests**

```bash
yarn test
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/js/rules/signature.js tests/signature.test.js
git commit -m "feat: parse numeric rule conditions in signature.js (literal + field-to-field)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 15: Fix PRV valueType for numeric variables (C6)

**Files:**
- Modify: `src/js/services/rules.js:27` (hardcoded `valueType: "DATE"`)

PRVs created for numeric variables currently get `valueType: "DATE"`, which is incorrect. The `variable.valueType` should be passed through.

- [ ] **Step 1: Fix prvGetSet to use variable valueType**

In `src/js/services/rules.js`, `prvGetSet`:
```js
// BEFORE
return {
    id: null, name,
    program: { id: programId },
    programRuleVariableSourceType: type === "dataElement" ? "DATAELEMENT_CURRENT_EVENT" : "TEI_ATTRIBUTE",
    dataElement: type === "dataElement" ? { id } : undefined,
    trackedEntityAttribute: type === "trackedEntityAttribute" ? { id } : undefined,
    valueType: "DATE"
};
// AFTER
return {
    id: null, name,
    program: { id: programId },
    programRuleVariableSourceType: type === "dataElement" ? "DATAELEMENT_CURRENT_EVENT" : "TEI_ATTRIBUTE",
    dataElement: type === "dataElement" ? { id } : undefined,
    trackedEntityAttribute: type === "trackedEntityAttribute" ? { id } : undefined,
    valueType: valueType || "DATE"
};
```

- [ ] **Step 2: Update prvGetSet signature to accept valueType**

```js
// BEFORE
export function prvGetSet(programMetadata, programId, programRuleVariablePrefix, type, id, nameFallback) {
// AFTER
export function prvGetSet(programMetadata, programId, programRuleVariablePrefix, type, id, nameFallback, valueType = "DATE") {
```

- [ ] **Step 3: Update ensureProgramRuleVariable to pass valueType**

```js
export async function ensureProgramRuleVariable(programMetadata, programId, programRuleVariablePrefix, variable, idFn = getId) {
    if (["enrollment", "incident", "event_date", "due_date", "current_date"].includes(variable.type)) {
        return { name: variable.prvName || variable.type };
    }
    const type = (variable.type === "data_element") ? "dataElement"
        : (variable.type === "attribute" ? "trackedEntityAttribute" : variable.type);
    let prv = prvGetSet(programMetadata, programId, programRuleVariablePrefix, type, variable.id, variable.name || variable.id, variable.valueType);
    if (!prv.id) {
        prv.id = await idFn();
        const created = await d2PostJson("/api/programRuleVariables", prv);
        return created;
    }
    return prv;
}
```

- [ ] **Step 4: Lint**

```bash
yarn lint
```

- [ ] **Step 5: Commit**

```bash
git add src/js/services/rules.js
git commit -m "fix: pass correct valueType when creating program rule variables for numeric fields

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 16: Dynamic details form for numeric variables (C7)

**Files:**
- Modify: `src/js/ui/details.js` (large update)

The form currently assumes date variables. For numeric variables, the operator dropdown and comparison UI must be different. Branch on `currentVariable.category`.

Key changes:
1. `populateComparisonDatesCtx` → renamed `populateComparisonOptionsCtx`; for numeric, populate other numeric variables in scope instead of date variables.
2. `setupValidationFormCtx` → show/hide date vs numeric form sections based on category.
3. `updateValidationPreviewCtx` → add numeric preview text.
4. `checkFormValidityCtx` → add numeric form validity.
5. `createValidationRuleCtx` → read numericComparisonType, numericValue, numericComparisonField.
6. `addValidationCtx` / `updateValidationCtx` → call numeric builders when `category === "numeric"`.

- [ ] **Step 1: Update populateComparisonOptionsCtx (was populateComparisonDatesCtx)**

```js
export function populateComparisonOptionsCtx(ctx) {
    const { getCurrent, getDateVars } = ctx;
    const currentVariable = getCurrent();
    const allVariables = getDateVars();
    if (!currentVariable || !allVariables) return;

    if (currentVariable.category === "numeric") {
        populateNumericComparisonFieldsCtx(ctx);
    } else {
        populateDateComparisonCtx(ctx);
    }
}

function populateDateComparisonCtx(ctx) {
    const { getCurrent, getDateVars } = ctx;
    const select = document.getElementById("comparisonDate"); if (!select) return;
    select.innerHTML = "<option value=\"\" disabled selected>Choose date...</option>";
    // ... (existing date-filtering logic, unchanged) ...
}

function populateNumericComparisonFieldsCtx(ctx) {
    const { getCurrent, getDateVars } = ctx;
    const select = document.getElementById("numericComparisonField"); if (!select) return;
    select.innerHTML = "<option value=\"\" disabled selected>Choose field...</option>";
    const currentVariable = getCurrent();
    const allVariables = getDateVars();
    (allVariables || []).forEach(v => {
        if (v.category !== "numeric") return;
        if (v.id === currentVariable.id && v.stageId === currentVariable.stageId) return;
        // Scope: same stage data elements + numeric TEAs
        let shouldInclude = false;
        if (v.type === "trackedEntityAttribute") shouldInclude = true;
        else if (v.type === "dataElement") shouldInclude = v.stageId === currentVariable.stageId;
        if (!shouldInclude) return;
        const option = document.createElement("option");
        option.value = `${v.type}:${v.id}${v.stageId ? ":" + v.stageId : ""}`;
        option.textContent = v.name;
        select.appendChild(option);
    });
}
```

- [ ] **Step 2: Update setupValidationFormCtx to show/hide date or numeric form sections**

```js
export function setupValidationFormCtx(ctx) {
    const { getCurrent } = ctx;
    // ... existing cleanup/reset code ...

    const currentVariable = getCurrent();
    const isNumeric = currentVariable?.category === "numeric";

    document.getElementById("dateForm").style.display = isNumeric ? "none" : "block";
    document.getElementById("numericForm").style.display = isNumeric ? "block" : "none";

    if (isNumeric) {
        document.getElementById("numericOperator").value = "";
        document.getElementById("numericComparisonType").value = "value";
        document.getElementById("numericValueInput").value = "";
        document.getElementById("numericComparisonField").value = "";
        document.getElementById("numericValueSection").style.display = "block";
        document.getElementById("numericFieldSection").style.display = "none";
    }

    populateComparisonOptionsCtx(ctx);
    setupFormEventListenersCtx(ctx);
    M.FormSelect.init(document.querySelectorAll("#dateVariableDetails select"));
}
```

- [ ] **Step 3: Add numeric form event listeners in setupFormEventListenersCtx**

Add change handlers for `numericOperator`, `numericComparisonType` (toggle value/field section), `numericValueInput`, `numericComparisonField`.

For comparison type toggle:
```js
document.getElementById("numericComparisonType")?.addEventListener("change", function() {
    const isField = this.value === "field";
    document.getElementById("numericValueSection").style.display = isField ? "none" : "block";
    document.getElementById("numericFieldSection").style.display = isField ? "block" : "none";
    updateValidationPreviewCtx(ctx);
    checkFormValidityCtx(ctx);
});
```

- [ ] **Step 4: Add numeric preview text in updateValidationPreviewCtx**

```js
if (isNumeric) {
    const numericOp = document.getElementById("numericOperator").value;
    const compType = document.getElementById("numericComparisonType").value;
    const numericValue = document.getElementById("numericValueInput").value;
    const fieldEl = document.querySelector("#numericComparisonField option:checked");
    const fieldName = fieldEl ? fieldEl.textContent : "";
    const opLabels = {
        greater_than: "greater than", greater_than_or_equal: "greater than or equal to",
        less_than: "less than", less_than_or_equal: "less than or equal to",
        equal_to: "equal to", not_equal_to: "not equal to"
    };
    if (numericOp) {
        const opLabel = opLabels[numericOp] || numericOp;
        if (compType === "value" && numericValue) {
            preview = `${variableName} should be ${opLabel} ${numericValue}`;
            suggestedRuleName = `${variableName} must be ${opLabel} ${numericValue}`;
            suggestedMessage = suggestedRuleName;
        } else if (compType === "field" && fieldName) {
            preview = `${variableName} should be ${opLabel} ${fieldName}`;
            suggestedRuleName = `${variableName} must be ${opLabel} ${fieldName}`;
            suggestedMessage = suggestedRuleName;
        }
    }
    // ... populate form fields with suggestions as before ...
    return;
}
```

- [ ] **Step 5: Update checkFormValidityCtx for numeric**

```js
if (isNumeric) {
    const numericOp = document.getElementById("numericOperator").value;
    const compType = document.getElementById("numericComparisonType").value;
    const numericValue = document.getElementById("numericValueInput").value;
    const numericField = document.getElementById("numericComparisonField").value;
    let isValid = numericOp && ruleName && ruleMessage;
    if (compType === "value") isValid = isValid && numericValue !== "";
    else isValid = isValid && numericField;
    document.getElementById("createValidationBtn").disabled = !isValid;
    return;
}
```

- [ ] **Step 6: Update createValidationRuleCtx to read numeric fields**

```js
if (isNumeric) {
    const numericOperator = document.getElementById("numericOperator").value;
    const numericComparisonType = document.getElementById("numericComparisonType").value;
    const numericValue = document.getElementById("numericValueInput").value;
    const numericComparisonField = document.getElementById("numericComparisonField").value;
    validationConfig = { numericOperator, numericComparisonType,
        numericValue: numericValue !== "" ? parseFloat(numericValue) : null,
        numericComparisonField, ruleName, ruleDescription, ruleMessage, actionType };
}
```

- [ ] **Step 7: Update addValidationCtx and updateValidationCtx to handle numeric**

In `addValidationCtx`, early branch on `currentVariable.category`:
```js
if (currentVariable.category === "numeric") {
    await addNumericValidationCtx(ctx, config);
    return;
}
// ... existing date logic ...
```

In `updateValidationCtx`, early branch:
```js
if (currentVariable.category === "numeric") {
    await updateNumericValidationCtx(ctx, config, ruleId);
    return;
}
// ... existing date logic ...
```

Implement `addNumericValidationCtx`:
```js
async function addNumericValidationCtx(ctx, config) {
    const { getCurrent, getMeta, getProgramId, getConfig } = ctx;
    const currentVariable = getCurrent();
    const variablePrv = await svcEnsurePrv(getMeta(), getProgramId(), getConfig()?.programRuleVariablePrefix, currentVariable);

    let ruleCondition;
    let compareVariable = null;

    if (config.numericComparisonType === "field") {
        const [compareType, compareId, compareStageId] = config.numericComparisonField.split(":");
        compareVariable = ctx.findByComponents(compareId, compareType, compareStageId);
        if (!compareVariable) { showMessage("Comparison field not found", "error"); return; }
        const comparePrv = await svcEnsurePrv(getMeta(), getProgramId(), getConfig()?.programRuleVariablePrefix, compareVariable);
        ruleCondition = generateNumericFieldCondition(
            { ...currentVariable, prvName: variablePrv.name },
            config.numericOperator,
            { ...compareVariable, prvName: comparePrv.name }
        );
    } else {
        ruleCondition = generateNumericCondition(
            { ...currentVariable, prvName: variablePrv.name },
            config.numericOperator,
            config.numericValue
        );
    }

    const prefix = getConfig()?.programRulePrefix || "";
    const actualName = config.ruleName;
    const ruleName = prefix ? `${prefix} - ${actualName}` : actualName;
    const { description } = addAppSignature(ruleName, config.ruleDescription || actualName);
    const programRule = { name: ruleName, description, condition: ruleCondition, program: { id: getProgramId() }, priority: 1 };
    const stageId = getValidationStageId(currentVariable, compareVariable);
    if (stageId) programRule.programStage = { id: stageId };

    const programRuleAction = {
        programRuleActionType: config.actionType || "SHOWERROR",
        content: config.ruleMessage,
        program: { id: getProgramId() }
    };
    if (currentVariable.type === "dataElement") programRuleAction.dataElement = { id: currentVariable.id };
    else if (currentVariable.type === "trackedEntityAttribute") programRuleAction.trackedEntityAttribute = { id: currentVariable.id };

    await svcPrCreate(getMeta(), programRule, [programRuleAction], []);
    showMessage("Validation rule created successfully");
    const refreshedMetadata = await refreshMetadata(ctx);
    if (refreshedMetadata) loadCurrentValidationsCtx(ctx);
    setupValidationFormCtx(ctx);
}
```

Implement `updateNumericValidationCtx` (PUT semantics — mirrors the date update path):
```js
async function updateNumericValidationCtx(ctx, config, ruleId) {
    const { getCurrent, getMeta, getProgramId, getConfig } = ctx;
    const currentVariable = getCurrent();
    if (!config || !currentVariable || !ruleId) { showMessage("Invalid configuration", "error"); return; }

    const existingRule = getMeta().programRules.find(r => r.id === ruleId);
    const existingActions = getMeta().programRuleActions.filter(a => a.programRule.id === ruleId);
    const existingAction = existingActions.find(a =>
        ["SHOWWARNING", "SHOWERROR", "WARNINGONCOMPLETE", "ERRORONCOMPLETE"].includes(a.programRuleActionType)
    );
    if (!existingRule || !existingAction) { showMessage("Rule or action not found for updating", "error"); return; }

    const variablePrv = await svcEnsurePrv(getMeta(), getProgramId(), getConfig()?.programRuleVariablePrefix, currentVariable);

    let ruleCondition;
    if (config.numericComparisonType === "field") {
        const [compareType, compareId, compareStageId] = config.numericComparisonField.split(":");
        const compareVariable = ctx.findByComponents(compareId, compareType, compareStageId);
        if (!compareVariable) { showMessage("Comparison field not found", "error"); return; }
        const comparePrv = await svcEnsurePrv(getMeta(), getProgramId(), getConfig()?.programRuleVariablePrefix, compareVariable);
        ruleCondition = generateNumericFieldCondition(
            { ...currentVariable, prvName: variablePrv.name },
            config.numericOperator,
            { ...compareVariable, prvName: comparePrv.name }
        );
    } else {
        ruleCondition = generateNumericCondition(
            { ...currentVariable, prvName: variablePrv.name },
            config.numericOperator,
            config.numericValue
        );
    }

    const prefix = getConfig()?.programRulePrefix || "";
    const actualName = config.ruleName;
    const ruleName = prefix ? `${prefix} - ${actualName}` : actualName;
    const { description } = addAppSignature(ruleName, config.ruleDescription || actualName);

    const updatedRule = { ...existingRule, name: ruleName, description, condition: ruleCondition };
    const updatedAction = { ...existingAction, content: config.ruleMessage, programRuleActionType: config.actionType || existingAction.programRuleActionType };

    await d2PutJson(`/api/programRules/${ruleId}`, updatedRule);
    await d2PutJson(`/api/programRuleActions/${existingAction.id}`, updatedAction);

    showMessage("Validation rule updated successfully");
    const refreshedMetadata = await refreshMetadata(ctx);
    if (refreshedMetadata) loadCurrentValidationsCtx(ctx);
    setupValidationFormCtx(ctx);
}
```

- [ ] **Step 8: Handle numeric in edit flow (app.js editValidation)**

After `parseRuleCondition` returns a numeric config, populate the numeric form fields:
```js
if (ruleConfig.config.comparisonType === "value" || ruleConfig.config.comparisonType === "field") {
    // numeric variable
    document.getElementById("numericOperator").value = ruleConfig.config.operator;
    document.getElementById("numericComparisonType").value = ruleConfig.config.comparisonType;
    if (ruleConfig.config.comparisonType === "value") {
        document.getElementById("numericValueInput").value = ruleConfig.config.value;
    } else if (ruleConfig.variable2) {
        const v2 = ruleConfig.variable2;
        document.getElementById("numericComparisonField").value =
            `${v2.type}:${v2.id}${v2.stageId ? ":" + v2.stageId : ""}`;
    }
}
```

- [ ] **Step 9: Parallelise PRV calls with Promise.all (D3)**

In `addValidationCtx` (date path) and `updateValidationCtx`, for two-PRV calls:
```js
const [variable1Prv, variable2Prv] = await Promise.all([
    svcEnsurePrv(getMeta(), getProgramId(), getConfig()?.programRuleVariablePrefix, currentVariable),
    svcEnsurePrv(getMeta(), getProgramId(), getConfig()?.programRuleVariablePrefix, compareDate)
]);
```

- [ ] **Step 10: Run full test suite**

```bash
yarn test
```

- [ ] **Step 11: Commit**

```bash
git add src/js/ui/details.js src/app.js
git commit -m "feat: add dynamic numeric validation form to details page

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 17: Update index.html for numeric form elements and title (C8)

**Files:**
- Modify: `src/index.html`
- Modify: `package.json` (manifest.webapp name)

Add the numeric form section, rename title.

- [ ] **Step 1: Rename title in index.html and package.json**

In `src/index.html` line 14:
```html
<!-- BEFORE -->
<h1>Tracker Date Validation Tool</h1>
<!-- AFTER -->
<h1>Tracker Validation Tool</h1>
```

In `package.json` manifest.webapp:
```json
"name": "Tracker Validation Tool"
```

- [ ] **Step 2: Wrap existing date form in a `#dateForm` div**

Wrap the existing operator+comparison row in:
```html
<div id="dateForm">
  <!-- existing: validationOperator + intervalInputs + comparisonDate row -->
</div>
```

- [ ] **Step 3: Add `#numericForm` div after `#dateForm`**

```html
<div id="numericForm" style="display: none;">
    <div class="row">
        <div class="col s12">
            <p class="validation-sentence" style="font-size: 1.1rem; line-height: 2.5rem;">
                <span id="validatedDateName" class="validation-date-name" style="font-weight: bold;">This value</span>
                <span> should be </span>
                <div class="input-field inline" style="width: 220px; margin: 0 10px;">
                    <select id="numericOperator" required>
                        <option value="" disabled selected>Choose relationship...</option>
                        <option value="greater_than">greater than</option>
                        <option value="greater_than_or_equal">greater than or equal to</option>
                        <option value="less_than">less than</option>
                        <option value="less_than_or_equal">less than or equal to</option>
                        <option value="equal_to">equal to</option>
                        <option value="not_equal_to">not equal to</option>
                    </select>
                </div>
                <div class="input-field inline" style="width: 160px; margin: 0 10px;">
                    <select id="numericComparisonType">
                        <option value="value" selected>a fixed value</option>
                        <option value="field">another field</option>
                    </select>
                </div>
                <span id="numericValueSection">
                    <div class="input-field inline" style="width: 100px; margin: 0 5px;">
                        <input id="numericValueInput" type="number" step="any" placeholder="0">
                    </div>
                </span>
                <span id="numericFieldSection" style="display: none;">
                    <div class="input-field inline" style="width: 220px; margin: 0 10px;">
                        <select id="numericComparisonField">
                            <option value="" disabled selected>Choose field...</option>
                        </select>
                    </div>
                </span>
            </p>
        </div>
    </div>
</div>
```

Note: `id="validatedDateName"` is the same ID used in the date form's variable name span. Since `#dateForm` and `#numericForm` are mutually exclusive (only one visible at a time), only one element with this ID will be active in the DOM. `showVariableDetailsCtx` sets `document.getElementById("validatedDateName").textContent` — this will correctly update whichever form section is visible. However, having duplicate IDs is invalid HTML. To avoid this, **move the `validatedDateName` span above both form divs** (outside `#dateForm`) so it is shared, and **remove** the `<span id="validatedDateName">` that currently lives inside the date form wrapper. Update the HTML restructure in Step 2 accordingly.

- [ ] **Step 4: Smoke test in browser**

Open app, select EIR programme, click a numeric variable. Verify: numeric form appears (date form hidden), operators are numeric, comparison type toggle works (value vs field).

Click a date variable. Verify: date form appears (numeric form hidden).

- [ ] **Step 5: Commit**

```bash
git add src/index.html package.json
git commit -m "feat: add numeric validation form elements; rename app to Tracker Validation Tool

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 18: Cleanup — standardise type strings (D2)

**Files:**
- Modify: `src/js/rules/detector.js`
- Modify: `src/js/rules/builder.js`
- Modify: `src/js/ui/details.js`

After A1 unified the type strings, remove all defensive dual-type checks (`"dataElement" || "data_element"`, `"trackedEntityAttribute" || "attribute"`).

- [ ] **Step 1: Remove dual-type checks in detector.js**

Remove all `|| type === "data_element"` and `|| type === "attribute"` guards from conditions in `prGetExisting` and `isVariablePrimaryTarget`.

- [ ] **Step 2: Remove dual-type checks in builder.js**

In `getVariableReference`, remove `"data_element"` and `"attribute"` case fallbacks. In `getValidationStageId`, remove `"data_element"` alternative.

- [ ] **Step 3: Remove dual-type checks in details.js**

In `populateComparisonDatesCtx`/`populateComparisonOptionsCtx`, remove all dual-type comparisons.

- [ ] **Step 4: Run all tests**

```bash
yarn test
```
Expected: all pass.

- [ ] **Step 5: Lint**

```bash
yarn lint
```

- [ ] **Step 6: Commit**

```bash
git add src/js/rules/detector.js src/js/rules/builder.js src/js/ui/details.js
git commit -m "refactor: remove legacy dual-type string checks after type unification

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 19: Final verification

- [ ] **Step 1: Full lint + test suite**

```bash
yarn lint && yarn test
```
Expected: lint clean, all tests pass.

- [ ] **Step 2: Build to verify webpack compiles**

```bash
yarn build
```
Expected: build succeeds, no errors.

- [ ] **Step 3: End-to-end smoke test via browser**

Using the dev server at http://localhost:8081 and the Electronic Immunization Registry programme:

1. Select EIR — all variables appear with date/numeric badges.
2. Open a date variable (e.g. GEN - Date of birth) → date form shown, create a "should be before" rule → verify saved correctly in DHIS2.
3. Open a numeric variable (e.g. age field) → numeric form shown, create "> 0" rule and a field-to-field rule → verify saved.
4. Edit an app-generated rule → fields pre-populate, update saves correctly.
5. Open settings → save config for the first time (new key) → verify no error.
6. Reload programme → prefix applies to rule names.
7. Verify action type selector works (create a "Show Warning" rule, verify action type in DHIS2).

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: final verification — all tests pass, lint clean, build successful

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
