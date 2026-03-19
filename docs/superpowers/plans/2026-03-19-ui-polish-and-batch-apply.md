# UI Polish + Batch Apply Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the validation count badge layout, split app-managed vs other rules in the details view, and implement a batch-apply feature that applies a configured validation rule to all unvalidated variables in one action.

**Architecture:** Seven sequential tasks. Tasks 1–3 are independent; Task 4 adds batch UI to HTML; Task 5 extracts a reusable create helper; Tasks 6–7 wire the batch logic and cleanup prompt. No new API endpoints or dependencies needed.

**Tech Stack:** Vanilla JS (ES modules), Webpack 5, custom CSS design system, DHIS2 REST API via `d2api.js` helpers.

---

## File Map

| File | Changes |
|------|---------|
| `src/css/style.css` | Remove broken `::after` rule; add `.validation-count` badge style; add batch panel styles |
| `src/js/ui/overview.js` | `updateValidationIndicators` injects count badge DOM; both render functions add count placeholder |
| `src/js/ui/details.js` | Split `loadCurrentValidationsCtx`; extract `createValidationForVariable` helper; add batch logic |
| `src/js/rules/signature.js` | Add `BATCH_TAG`, `isBatchGenerated`, `addBatchSignature` |
| `tests/signature.test.js` | Tests for new batch signature functions |
| `src/index.html` | Add `#batchApplyBtn`, `#batchApplyPanel`, `#batchVariableList` |

---

## Task 1: Fix badge layout + inject validation count

**Files:**
- Modify: `src/css/style.css` (remove broken `::after` pseudo-element rule, add `.validation-count`)
- Modify: `src/js/ui/overview.js` (`createDateVariableElement`, `renderStageVarHtml`, `updateValidationIndicators`)

The current `.has-validation::after` pseudo-element creates a new flex item *after* the type badge (which has `margin-left:auto`), making ✓ appear to the right of the badge mid-row. Fix: remove the pseudo-element, inject a real `<span class="validation-count">` DOM node whose text is the rule count.

- [ ] **Step 1: Remove broken CSS rule and add `.validation-count` style**

In `src/css/style.css`, replace:
```css
.date-variable.has-validation::after {
    content: "✓";
    margin-left: auto;
    color: var(--green);
    font-weight: 700;
    font-size: 13px;
}
```
with:
```css
.validation-count {
    font-size: 11px;
    font-weight: 600;
    color: var(--green);
    background: var(--green-light, #e8f5e9);
    padding: 1px 7px;
    border-radius: 20px;
    white-space: nowrap;
}
```

(Keep `.date-variable.has-validation { border-left-color: var(--green); }` unchanged.)

- [ ] **Step 2: Add count badge placeholder in `createDateVariableElement`**

In `src/js/ui/overview.js`, in `createDateVariableElement`, change the `div.innerHTML` template to include a count span (hidden by default, before the type badge):

```js
div.innerHTML = `
    <strong>${dateVar.name}</strong>
    <span class="var-type-label">(${getVariableTypeLabel(dateVar.type)})</span>
    <span class="validation-count" style="margin-left:auto;display:none"></span>
    <span class="variable-badge ${badgeClass}">${badgeLabel}</span>`;
```

(Note: `margin-left:auto` moves to the count span; remove it from the type badge span.)

- [ ] **Step 3: Add count badge placeholder in `renderStageVarHtml`**

Same change in `renderStageVarHtml`:

```js
function renderStageVarHtml(dateVar) {
    const badgeClass = dateVar.category === "numeric" ? "variable-badge-numeric" : "variable-badge-date";
    const badgeLabel = dateVar.category === "numeric" ? "Numeric" : "Date";
    return `<div class="date-variable" data-variable='${JSON.stringify(dateVar)}'>
        <strong>${dateVar.name}</strong>
        <span class="var-type-label">(${getVariableTypeLabel(dateVar.type)})</span>
        <span class="validation-count" style="margin-left:auto;display:none"></span>
        <span class="variable-badge ${badgeClass}">${badgeLabel}</span>
    </div>`;
}
```

- [ ] **Step 4: Update `updateValidationIndicators` to set count text**

Replace the existing function:

```js
export function updateValidationIndicators(programMetadata) {
    document.querySelectorAll(".date-variable").forEach(element => {
        const variableData = JSON.parse(element.dataset.variable);
        const validations = detectExisting(programMetadata, variableData);
        const count = validations.length;
        const countEl = element.querySelector(".validation-count");
        if (count > 0) {
            element.classList.add("has-validation");
            if (countEl) {
                countEl.textContent = count === 1 ? "1 rule" : `${count} rules`;
                countEl.style.display = "";
            }
        } else {
            element.classList.remove("has-validation");
            if (countEl) countEl.style.display = "none";
        }
    });
}
```

- [ ] **Step 5: Run tests and lint**

```bash
yarn test && yarn lint
```

Expected: 32/32 pass, no lint errors.

- [ ] **Step 6: Commit**

```bash
git add src/css/style.css src/js/ui/overview.js
git commit -m "fix: replace CSS ::after badge with injected validation count DOM element"
```

---

## Task 2: Split app-managed vs other rules in details view

**Files:**
- Modify: `src/js/ui/details.js` — `loadCurrentValidationsCtx` function
- No HTML changes needed; `#otherProgramRulesCard` and `#otherProgramRules` already exist (currently hidden)

Currently all rules (app-managed and non-app-managed) appear in `#currentValidations`, both with Edit/Delete buttons. Fix: app-managed rules go to `#currentValidations` with Edit+Delete; non-app-managed rules go to `#otherProgramRules` as read-only (no Edit, Delete button is still present since a superuser may want to remove conflicting rules).

- [ ] **Step 1: Update `loadCurrentValidationsCtx` to split by `isAppGenerated`**

Replace the function (lines 308–336) with:

```js
export function loadCurrentValidationsCtx(ctx) {
    const { getCurrent, getMeta } = ctx;
    const variable = getCurrent(); if (!variable) return;

    const validations = detectExisting(getMeta(), variable);
    const appValidations = validations.filter(v => isAppGenerated(v.rule));
    const otherValidations = validations.filter(v => !isAppGenerated(v.rule));

    const container = document.getElementById("currentValidations");
    if (appValidations.length === 0) {
        container.innerHTML = "<p class='empty-state'>No validations configured for this variable.</p>";
    } else {
        container.innerHTML = appValidations.map(validation => renderValidationCard(validation, true)).join("");
    }

    const otherCard = document.getElementById("otherProgramRulesCard");
    const otherContainer = document.getElementById("otherProgramRules");
    if (otherValidations.length > 0) {
        otherCard.style.display = "";
        otherContainer.innerHTML = otherValidations.map(validation => renderValidationCard(validation, false)).join("");
    } else {
        otherCard.style.display = "none";
        otherContainer.innerHTML = "";
    }
}

function renderValidationCard(validation, isEditable) {
    const action = validation.actions.find(a =>
        ["SHOWWARNING", "SHOWERROR", "WARNINGONCOMPLETE", "ERRORONCOMPLETE"].includes(a.programRuleActionType)
    );
    const actionType = action ? action.programRuleActionType : "UNKNOWN";
    const actionClass = actionType.includes("ERROR") ? "error" : "warning";
    const displayName = validation.rule.name;

    return `
        <div class="validation-rule ${actionClass}">
            <h6>${displayName}</h6>
            <p><strong>Rule ID:</strong> <code>${validation.rule.id}</code></p>
            <p><strong>Condition:</strong> ${validation.rule.condition}</p>
            <p><strong>Action:</strong> ${actionType}</p>
            ${action?.content ? `<p><strong>Message:</strong> ${action.content}</p>` : ""}
            <div class="validation-actions">
                ${isEditable ? `<button class="btn btn-sm btn-secondary" onclick="editValidation('${validation.rule.id}')">Edit</button>` : ""}
                <button class="btn btn-sm btn-danger" onclick="deleteValidation('${validation.rule.id}')">Delete</button>
            </div>
        </div>`;
}
```

- [ ] **Step 2: Run tests and lint**

```bash
yarn test && yarn lint
```

Expected: 32/32 pass, no lint errors.

- [ ] **Step 3: Commit**

```bash
git add src/js/ui/details.js
git commit -m "feat: split app-managed vs other program rules in details view"
```

---

## Task 3: Add batch signature support to signature.js

**Files:**
- Modify: `src/js/rules/signature.js`
- Modify: `tests/signature.test.js`

Batch-generated rules need to be identifiable so they can be cleaned up when a specific rule is created for the same variable.

- [ ] **Step 1: Write failing tests in `tests/signature.test.js`**

Add at the end of the file:

```js
describe("batch signature", () => {
    it("isBatchGenerated returns true when both tags present", () => {
        const rule = { description: "[DVT] [DVT-BATCH] Batch rule" };
        expect(isBatchGenerated(rule)).toBe(true);
    });

    it("isBatchGenerated returns false for app-generated but not batch", () => {
        const rule = { description: "[DVT] Normal rule" };
        expect(isBatchGenerated(rule)).toBe(false);
    });

    it("isBatchGenerated returns false for non-app rule", () => {
        const rule = { description: "Some other rule" };
        expect(isBatchGenerated(rule)).toBe(false);
    });

    it("addBatchSignature adds both [DVT] and [DVT-BATCH] tags to description", () => {
        const { description } = addBatchSignature("My rule", "My desc");
        expect(description).toMatch(/\[DVT\]/);
        expect(description).toMatch(/\[DVT-BATCH\]/);
    });

    it("addBatchSignature does not duplicate tags on re-apply", () => {
        const { description: d1 } = addBatchSignature("My rule", "[DVT] [DVT-BATCH] My desc");
        const occurrences = (d1.match(/\[DVT-BATCH\]/g) || []).length;
        expect(occurrences).toBe(1);
    });
});
```

Add to the import at the top of the test file:
```js
import { parseRuleCondition, isBatchGenerated, addBatchSignature } from "../src/js/rules/signature.js";
```

- [ ] **Step 2: Run test to verify it fails**

```bash
yarn test tests/signature.test.js
```

Expected: FAIL — `isBatchGenerated is not a function`

- [ ] **Step 3: Implement batch signature functions in `signature.js`**

Add after the existing `removeAppSignature` export:

```js
export const BATCH_TAG = "DVT-BATCH";

export function isBatchGenerated(rule) {
    if (!isAppGenerated(rule)) return false;
    return rule.description.includes(`[${BATCH_TAG}]`);
}

export function addBatchSignature(ruleName, description) {
    const { name, description: dvtDesc } = addAppSignature(ruleName, description);
    const batchMarker = `[${BATCH_TAG}]`;
    const descWithBatch = dvtDesc.includes(batchMarker)
        ? dvtDesc
        : dvtDesc.replace(`[${getAppSignature()}]`, `[${getAppSignature()}] ${batchMarker}`);
    return { name, description: descWithBatch };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
yarn test tests/signature.test.js
```

Expected: all signature tests pass.

- [ ] **Step 5: Run full test suite + lint**

```bash
yarn test && yarn lint
```

Expected: 37/37 pass (5 new), no lint errors.

- [ ] **Step 6: Commit**

```bash
git add src/js/rules/signature.js tests/signature.test.js
git commit -m "feat: add batch rule signature (BATCH_TAG, isBatchGenerated, addBatchSignature)"
```

---

## Task 4: Add batch apply UI to index.html + CSS

**Files:**
- Modify: `src/index.html` — add `#batchApplyBtn` and `#batchApplyPanel`
- Modify: `src/css/style.css` — add batch panel styles

- [ ] **Step 1: Add batch apply button after `#createValidationBtn` in `index.html`**

Locate the `#createValidationBtn` button in the form footer and add below it:

```html
<button id="batchApplyBtn" class="btn btn-secondary" style="display:none;">
    Apply to all unvalidated…
</button>
```

The batch button is hidden by default; it is shown by JS when the form is valid and the user has not yet clicked Create.

- [ ] **Step 2: Add batch apply panel in `index.html`**

Immediately after the form card (before the `#currentValidationsCard`), add:

```html
<div id="batchApplyPanel" class="card" style="display:none;">
    <div class="card-header">
        <h3>Batch Apply</h3>
        <p class="card-subtitle">Apply this validation to all unvalidated variables of the same type.</p>
    </div>
    <div class="card-body">
        <div class="batch-scope-row">
            <label><input type="radio" name="batchScope" value="programme" checked> Whole programme</label>
            <label><input type="radio" name="batchScope" value="stage"> This stage only</label>
        </div>
        <p id="batchScopeSummary" class="batch-summary"></p>
        <div id="batchVariableList" class="batch-variable-list"></div>
        <div class="form-footer" style="margin-top:16px;">
            <button id="batchApplyCancelBtn" class="btn btn-secondary">Cancel</button>
            <button id="batchApplyConfirmBtn" class="btn btn-primary">Apply to Selected</button>
        </div>
    </div>
</div>
```

- [ ] **Step 3: Add batch panel CSS to `style.css`**

```css
/* --- Batch Apply Panel --- */
.batch-scope-row { display: flex; gap: 20px; margin-bottom: 12px; }
.batch-scope-row label { display: flex; align-items: center; gap: 6px; font-size: 14px; cursor: pointer; }
.batch-summary { font-size: 13px; color: var(--text-3); margin-bottom: 12px; }
.batch-variable-list { display: flex; flex-direction: column; gap: 4px; max-height: 280px; overflow-y: auto;
    border: 1px solid var(--border); border-radius: var(--radius); padding: 8px; }
.batch-variable-item { display: flex; align-items: center; gap: 8px; padding: 6px 8px;
    border-radius: var(--radius); font-size: 13px; }
.batch-variable-item:hover { background: var(--bg-2); }
.batch-variable-item label { flex: 1; cursor: pointer; display: flex; gap: 8px; align-items: center; }
.batch-variable-item .var-type-label { color: var(--text-3); }
```

- [ ] **Step 4: Run lint and build**

```bash
yarn lint && yarn build
```

Expected: no errors, build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/index.html src/css/style.css
git commit -m "feat: add batch apply button and panel UI"
```

---

## Task 5: Extract reusable `createValidationForVariable` helper

**Files:**
- Modify: `src/js/ui/details.js`

Both `addValidationCtx` (date) and `addNumericValidationCtx` currently assume `ctx.getCurrent()` is the variable to create for. The batch runner needs to create rules for variables other than the currently selected one. This task extracts the core rule-creation logic into functions that accept an explicit `targetVariable` parameter and an optional `signatureFn` override (for batch tagging).

- [ ] **Step 1: Extract `createDateValidationForVariable`**

Add a new private async function above `addValidationCtx`:

```js
async function createDateValidationForVariable(ctx, config, targetVariable, signatureFn = addAppSignature) {
    const { getMeta, getProgramId, getConfig } = ctx;
    const [compareType, compareId, compareStageId] = config.comparisonDate.split(":");
    const compareDate = ctx.findByComponents(compareId, compareType, compareStageId);
    if (!compareDate) throw new Error("Target date not found");

    const duplicateRule = findDuplicateRule(getMeta(), targetVariable, config);
    if (duplicateRule) throw new Error(`Duplicate rule already exists: "${duplicateRule.name}"`);

    const finalRuleName = generateRuleName(targetVariable, compareDate, config.operator, config.ruleName);
    const existingRule = getMeta().programRules.find(rule => rule.name === finalRuleName);
    if (existingRule) throw new Error(`Rule "${finalRuleName}" already exists`);

    const variable1Prv = await svcEnsurePrv(getMeta(), getProgramId(), getConfig()?.programRuleVariablePrefix, targetVariable);
    const variable2Prv = await svcEnsurePrv(getMeta(), getProgramId(), getConfig()?.programRuleVariablePrefix, compareDate);

    const prefix = getConfig()?.programRulePrefix || "";
    const ruleCondition = generateNewRuleCondition({ ...targetVariable, prvName: variable1Prv.name }, { ...compareDate, prvName: variable2Prv.name }, config);

    let actualName = generateRuleName(targetVariable, compareDate, config.operator, config.ruleName);
    let ruleName = prefix ? `${prefix} - ${actualName}` : actualName;
    const defaultDesc = generateDefaultDescription(targetVariable, compareDate, config.operator, config.intervalAmount, config.intervalUnit);
    const { description } = signatureFn(ruleName, config.ruleDescription || defaultDesc);

    const programRule = { name: ruleName, description, condition: ruleCondition, program: { id: getProgramId() }, priority: 1 };
    if (targetVariable.type === "dataElement" && targetVariable.stageId) programRule.programStage = { id: targetVariable.stageId };
    if (targetVariable.type === "event_date" && targetVariable.stageId) programRule.programStage = { id: targetVariable.stageId };

    const programRuleAction = { programRuleActionType: config.actionType || "SHOWERROR", content: config.ruleMessage, program: { id: getProgramId() } };
    if (targetVariable.type === "dataElement") programRuleAction.dataElement = { id: targetVariable.id };
    else if (targetVariable.type === "trackedEntityAttribute") programRuleAction.trackedEntityAttribute = { id: targetVariable.id };

    await svcPrCreate(getMeta(), programRule, [programRuleAction], []);
}
```

- [ ] **Step 2: Extract `createNumericValidationForVariable`**

Add a similar function above `addNumericValidationCtx`:

```js
async function createNumericValidationForVariable(ctx, config, targetVariable, signatureFn = addAppSignature) {
    const { getMeta, getProgramId, getConfig } = ctx;
    let ruleCondition;
    let compareField = null;
    if (config.numericComparisonType === "field") {
        const [compareType, compareId, compareStageId] = config.numericComparisonField.split(":");
        compareField = ctx.findByComponents(compareId, compareType, compareStageId);
        if (!compareField) throw new Error("Comparison field not found");
    }
    const variable1Prv = await svcEnsurePrv(getMeta(), getProgramId(), getConfig()?.programRuleVariablePrefix, targetVariable);
    const variable1WithPrv = { ...targetVariable, prvName: variable1Prv.name };
    if (config.numericComparisonType === "field") {
        const variable2Prv = await svcEnsurePrv(getMeta(), getProgramId(), getConfig()?.programRuleVariablePrefix, compareField);
        ruleCondition = generateNumericFieldCondition(variable1WithPrv, config.numericOperator, { ...compareField, prvName: variable2Prv.name });
    } else {
        ruleCondition = generateNumericCondition(variable1WithPrv, config.numericOperator, config.numericValue);
    }
    const prefix = getConfig()?.programRulePrefix || "";
    const ruleName = prefix ? `${prefix} - ${config.ruleName}` : config.ruleName;
    const defaultDesc = generateDefaultNumericDescription(targetVariable, config.numericOperator, config.numericComparisonType, config.numericValue, compareField);
    const { description } = signatureFn(ruleName, config.ruleDescription || defaultDesc);
    const programRule = { name: ruleName, description, condition: ruleCondition, program: { id: getProgramId() }, priority: 1 };
    if (targetVariable.type === "dataElement" && targetVariable.stageId) programRule.programStage = { id: targetVariable.stageId };
    const programRuleAction = { programRuleActionType: config.actionType || "SHOWERROR", content: config.ruleMessage, program: { id: getProgramId() } };
    if (targetVariable.type === "dataElement") programRuleAction.dataElement = { id: targetVariable.id };
    else if (targetVariable.type === "trackedEntityAttribute") programRuleAction.trackedEntityAttribute = { id: targetVariable.id };
    await svcPrCreate(getMeta(), programRule, [programRuleAction], []);
}
```

- [ ] **Step 3: Simplify `addNumericValidationCtx` to delegate to the new helper**

Replace the body of `addNumericValidationCtx`:

```js
async function addNumericValidationCtx(ctx, config) {
    const currentVariable = ctx.getCurrent();
    try {
        await createNumericValidationForVariable(ctx, config, currentVariable);
        showMessage("Validation rule created successfully");
        const refreshedMetadata = await refreshMetadata(ctx);
        if (refreshedMetadata) loadCurrentValidationsCtx(ctx);
        setupValidationFormCtx(ctx);
    } catch (error) {
        console.error("Error creating numeric validation rule:", error);
        showMessage("Error creating validation rule: " + (error.message || error), "error");
    }
}
```

- [ ] **Step 4: Simplify `addValidationCtx` (date path) to delegate to the new helper**

Replace the `try` block in `addValidationCtx` (keeping only the numeric-dispatch guard and error handling):

```js
export async function addValidationCtx(ctx, config) {
    const currentVariable = ctx.getCurrent();
    if (!config || !currentVariable) { showMessage("Invalid configuration", "error"); return; }
    if (currentVariable.category === "numeric") { return addNumericValidationCtx(ctx, config); }
    try {
        await createDateValidationForVariable(ctx, config, currentVariable);
        showMessage("Validation rule created successfully");
        const refreshedMetadata = await refreshMetadata(ctx);
        if (refreshedMetadata) loadCurrentValidationsCtx(ctx);
        setupValidationFormCtx(ctx);
    } catch (error) {
        console.error("Error creating date validation rule:", error);
        showMessage("Error creating validation rule: " + (error.message || error), "error");
    }
}
```

- [ ] **Step 5: Add `addBatchSignature` import to the imports section of `details.js`**

Find the signature.js import line and add `addBatchSignature` and `isBatchGenerated`:

```js
import { isAppGenerated, addAppSignature, findDuplicateRule, addBatchSignature, isBatchGenerated } from "../rules/signature.js";
```

- [ ] **Step 6: Run full test suite + lint**

```bash
yarn test && yarn lint
```

Expected: all tests pass (refactored paths still produce same outputs), no lint errors.

- [ ] **Step 7: Commit**

```bash
git add src/js/ui/details.js
git commit -m "refactor: extract createDateValidationForVariable and createNumericValidationForVariable helpers"
```

---

## Task 6: Implement batch apply logic

**Files:**
- Modify: `src/js/ui/details.js` — add `showBatchApplyPanel`, `executeBatchApply`, update `setupFormEventListenersCtx`

- [ ] **Step 1: Add `showBatchApplyPanel` function**

Add after `addValidationCtx`:

```js
function getUnvalidatedVariables(ctx, category, stageId) {
    const { getMeta, getDateVars, getCurrent } = ctx;
    const current = getCurrent();
    const all = getDateVars() || [];
    return all.filter(v => {
        if (v.category !== category) return false;
        if (v.id === current.id && v.type === current.type && v.stageId === current.stageId) return false;
        if (stageId !== null && v.stageId !== stageId) return false;
        const existing = detectExisting(getMeta(), v);
        return existing.length === 0;
    });
}

function renderBatchVariableList(variables) {
    if (variables.length === 0) {
        return "<p class='empty-state'>No unvalidated variables found for this scope.</p>";
    }
    return variables.map(v => `
        <div class="batch-variable-item">
            <label>
                <input type="checkbox" class="batch-var-check" value="${v.type}:${v.id}${v.stageId ? ":" + v.stageId : ""}" checked>
                <strong>${v.name}</strong>
                <span class="var-type-label">(${v.type})</span>
            </label>
        </div>`).join("");
}

export function showBatchApplyPanel(ctx, config) {
    const panel = document.getElementById("batchApplyPanel");
    if (!panel) return;
    panel.style.display = "";

    const current = ctx.getCurrent();
    const category = current?.category || "date";
    const currentStageId = current?.stageId || null;

    function refreshList() {
        const scope = document.querySelector("input[name='batchScope']:checked")?.value || "programme";
        const stageId = scope === "stage" ? currentStageId : null;
        const unvalidated = getUnvalidatedVariables(ctx, category, stageId);
        document.getElementById("batchVariableList").innerHTML = renderBatchVariableList(unvalidated);
        const summary = document.getElementById("batchScopeSummary");
        if (summary) {
            summary.textContent = unvalidated.length === 0
                ? "All variables already have validations."
                : `${unvalidated.length} unvalidated ${category} variable${unvalidated.length !== 1 ? "s" : ""} found — all pre-selected.`;
        }
    }

    document.querySelectorAll("input[name='batchScope']").forEach(r => {
        r.addEventListener("change", refreshList);
    });
    refreshList();

    const confirmBtn = document.getElementById("batchApplyConfirmBtn");
    const newConfirmBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
    newConfirmBtn.addEventListener("click", () => executeBatchApply(ctx, config));

    const cancelBtn = document.getElementById("batchApplyCancelBtn");
    const newCancelBtn = cancelBtn.cloneNode(true);
    cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
    newCancelBtn.addEventListener("click", () => { panel.style.display = "none"; });
}

async function executeBatchApply(ctx, config) {
    const panel = document.getElementById("batchApplyPanel");
    const checked = [...document.querySelectorAll(".batch-var-check:checked")].map(cb => cb.value);
    if (checked.length === 0) { showMessage("No variables selected.", "error"); return; }

    const allVars = ctx.getDateVars() || [];
    const targets = checked.map(key => {
        const [type, id, stageId] = key.split(":");
        return allVars.find(v => v.type === type && v.id === id && (v.stageId || "") === (stageId || ""));
    }).filter(Boolean);

    let successCount = 0;
    const errors = [];

    for (const target of targets) {
        try {
            if (target.category === "numeric") {
                await createNumericValidationForVariable(ctx, config, target, addBatchSignature);
            } else {
                await createDateValidationForVariable(ctx, config, target, addBatchSignature);
            }
            successCount++;
        } catch (err) {
            errors.push(`${target.name}: ${err.message}`);
        }
    }

    if (panel) panel.style.display = "none";

    if (errors.length > 0) {
        showMessage(`Created ${successCount} rule(s). ${errors.length} skipped: ${errors.join("; ")}`, "error");
    } else {
        showMessage(`Created ${successCount} validation rule${successCount !== 1 ? "s" : ""} successfully`);
    }

    const refreshedMetadata = await refreshMetadata(ctx);
    if (refreshedMetadata) {
        loadCurrentValidationsCtx(ctx);
        updateValidationIndicators(refreshedMetadata);
    }
    setupValidationFormCtx(ctx);
}
```

- [ ] **Step 2: Import `updateValidationIndicators` from overview.js in details.js**

At the top of `details.js`, add:
```js
import { updateValidationIndicators } from "./overview.js";
```

(Check if it's already imported; add to existing import if so.)

- [ ] **Step 3: Show/hide `#batchApplyBtn` from `checkFormValidityCtx` and wire its click listener**

In `setupFormEventListenersCtx`, after the `createBtn` wiring (after line ~141), add:

```js
const batchApplyBtn = document.getElementById("batchApplyBtn");
if (batchApplyBtn) {
    const newBatchBtn = batchApplyBtn.cloneNode(true);
    batchApplyBtn.parentNode.replaceChild(newBatchBtn, batchApplyBtn);
    newBatchBtn.addEventListener("click", () => {
        const config = collectFormConfigCtx(ctx);
        if (config) showBatchApplyPanel(ctx, config);
    });
}
```

In `checkFormValidityCtx` (wherever the create button is enabled/disabled), also toggle the batch button:

```js
const batchBtn = document.getElementById("batchApplyBtn");
if (batchBtn) batchBtn.style.display = isValid ? "" : "none";
```

- [ ] **Step 4: Export `collectFormConfigCtx` (or rename from existing config reader)**

In `details.js`, `createValidationRuleCtx` (around line 280–310) reads all the form fields and builds a config object. Extract this read-and-validate portion into a new exported function `collectFormConfigCtx(ctx)` that returns the config object or `null` if the form is not valid/complete.

The returned object for date rules has shape: `{ comparisonDate, operator, intervalAmount, intervalUnit, ruleName, ruleDescription, ruleMessage, actionType }`. For numeric rules: `{ numericOperator, numericComparisonType, numericValue, numericComparisonField, ruleName, ruleDescription, ruleMessage, actionType }`.

Call `collectFormConfigCtx` from both `createValidationRuleCtx` (replacing the inline read) and from the batch button click handler. Also note: `ctx.getDateVars()` is already wired in `app.js` alongside `getCurrent`, `getMeta`, etc. — it is safe to use in `getUnvalidatedVariables`.

- [ ] **Step 5: Run tests and lint**

```bash
yarn test && yarn lint
```

Expected: all tests pass, no lint errors.

- [ ] **Step 6: Commit**

```bash
git add src/js/ui/details.js
git commit -m "feat: implement batch apply logic (showBatchApplyPanel, executeBatchApply)"
```

---

## Task 7: Offer to remove batch rules after a specific rule is created

**Files:**
- Modify: `src/js/ui/details.js` — `addValidationCtx` and `addNumericValidationCtx` success paths

When a user creates a specific rule for a variable that already has a batch-generated rule targeting the same variable, the batch rule is now superseded. Prompt to remove it.

- [ ] **Step 1: Add `offerBatchRuleCleanup` helper**

Add after `showBatchApplyPanel`:

```js
async function offerBatchRuleCleanup(ctx, targetVariable) {
    const { getMeta } = ctx;
    const validations = detectExisting(getMeta(), targetVariable);
    const batchRules = validations.filter(v => isBatchGenerated(v.rule));
    if (batchRules.length === 0) return;

    const names = batchRules.map(v => `"${v.rule.name}"`).join(", ");
    const msg = batchRules.length === 1
        ? `This variable already has a batch rule: ${names}.\nRemove it since you now have a specific rule?`
        : `This variable has ${batchRules.length} batch rules: ${names}.\nRemove them since you now have a specific rule?`;

    if (!confirm(msg)) return;

    for (const { rule, actions } of batchRules) {
        for (const action of actions) {
            try { await d2Delete(`/api/programRuleActions/${action.id}`); } catch (e) { console.warn("Could not delete action", e); }
        }
        try { await d2Delete(`/api/programRules/${rule.id}`); } catch (e) { console.warn("Could not delete rule", e); }
    }
    showMessage(`Removed ${batchRules.length} batch rule${batchRules.length !== 1 ? "s" : ""}`);
}
```

- [ ] **Step 2: Call `offerBatchRuleCleanup` after successful create in `addValidationCtx`**

In the success path of `addValidationCtx` (after `showMessage("Validation rule created successfully")`):

```js
await offerBatchRuleCleanup(ctx, currentVariable);
```

- [ ] **Step 3: Same call in `addNumericValidationCtx`**

Same location, same line added after the success showMessage.

Important: call `offerBatchRuleCleanup` BEFORE `refreshMetadata`. The cleanup needs the current metadata to find batch rules; after `refreshMetadata` those deletes will already be reflected. Correct order: create → offerCleanup → refreshMetadata → render.

- [ ] **Step 4: Run full test suite + lint**

```bash
yarn test && yarn lint
```

Expected: all tests pass, no lint errors.

- [ ] **Step 5: Commit**

```bash
git add src/js/ui/details.js
git commit -m "feat: offer to remove batch rules when a specific rule is created for a variable"
```

---

## Final Verification

- [ ] **Run full test suite**

```bash
yarn test
```

Expected: all tests pass (37+ with new batch signature tests).

- [ ] **Run lint**

```bash
yarn lint
```

Expected: 0 errors.

- [ ] **Run build**

```bash
yarn build
```

Expected: build succeeds with no warnings about missing modules.

- [ ] **Manual smoke test (dev server)**

```bash
yarn start
```

Verify in browser:
1. Variable list shows count badge (e.g. "2 rules") next to green border, not a floating ✓
2. Details view shows app-managed rules in top card, other rules in separate card when present
3. Clicking "Apply to all unvalidated…" shows the batch panel with scope options and checklist
4. Batch create works without errors; count badges update after batch
5. Creating a specific rule when a batch rule exists prompts for cleanup

