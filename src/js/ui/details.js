import M from "materialize-css";
import { prGetExisting as detectExisting } from "../rules/detector.js";
import { generateNewRuleCondition } from "../rules/builder.js";
import { ensureProgramRuleVariable as svcEnsurePrv, prCreate as svcPrCreate } from "../services/rules.js";
import { showMessage } from "./toast.js";

export function showVariableDetailsCtx(ctx, variable) {
    const { setCurrent } = ctx;
    setCurrent(variable);
    document.getElementById("dateVariablesOverview").style.display = "none";
    document.getElementById("dateVariableDetails").style.display = "block";
    document.getElementById("variableDetailsTitle").textContent = `${variable.name} - Validation Settings`;
    document.getElementById("validatedDateName").textContent = variable.name;
    loadCurrentValidationsCtx(ctx);
    setupValidationFormCtx(ctx);
}

export function setupValidationFormCtx(ctx) {
    document.getElementById("validationOperator").value = "";
    document.getElementById("comparisonDate").value = "";
    document.getElementById("intervalInputs").style.display = "none";
    document.getElementById("intervalAmount").value = "";
    document.getElementById("intervalUnit").value = "days";
    document.getElementById("createValidationBtn").disabled = true;
    document.getElementById("ruleName").value = "";
    document.getElementById("ruleDescription").value = "";
    document.getElementById("ruleMessage").value = "";
    populateComparisonDatesCtx(ctx);
    setupFormEventListenersCtx(ctx);
    const allSelects = document.querySelectorAll("#dateVariableDetails select");
    allSelects.forEach(select => { const instance = M.FormSelect.getInstance(select); if (instance) instance.destroy(); });
    M.FormSelect.init(allSelects);
}

export function setupFormEventListenersCtx(ctx) {
    const operatorSelect = document.getElementById("validationOperator");
    const newOperatorSelect = operatorSelect.cloneNode(true);
    operatorSelect.parentNode.replaceChild(newOperatorSelect, operatorSelect);
    const handleOperatorChange = function() {
        const value = this.value;
        const intervalInputs = document.getElementById("intervalInputs");
        const intervalDirection = document.getElementById("intervalDirection");
        if (value === "within_before" || value === "within_after") {
            intervalInputs.style.display = "inline-flex";
            intervalDirection.textContent = value === "within_before" ? " before" : " after";
        } else {
            intervalInputs.style.display = "none";
        }
        updateValidationPreviewCtx(ctx);
        checkFormValidityCtx();
    };
    document.getElementById("validationOperator").addEventListener("change", handleOperatorChange);
    document.getElementById("validationOperator").addEventListener("click", function(){ setTimeout(handleOperatorChange.bind(this), 100); });
    ["comparisonDate", "intervalAmount", "intervalUnit", "ruleName", "ruleMessage"].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener("change", () => { updateValidationPreviewCtx(ctx); checkFormValidityCtx(); });
            el.addEventListener("input", () => { updateValidationPreviewCtx(ctx); checkFormValidityCtx(); });
        }
    });
    const createBtn = document.getElementById("createValidationBtn");
    if (createBtn) createBtn.addEventListener("click", () => createValidationRuleCtx(ctx));
}

export function updateValidationPreviewCtx(ctx) {
    const { getCurrent } = ctx;
    const operator = document.getElementById("validationOperator").value;
    const comparisonDate = document.getElementById("comparisonDate").value;
    const intervalAmount = document.getElementById("intervalAmount").value;
    const intervalUnit = document.getElementById("intervalUnit").value;
    let preview = ""; let suggestedRuleName = ""; let suggestedMessage = "";
    if (operator && comparisonDate) {
        const variableName = getCurrent().name;
        const comparisonOption = document.querySelector(`#comparisonDate option[value="${comparisonDate}"]`);
        const comparisonName = comparisonOption ? comparisonOption.textContent : "";
        switch (operator) {
        case "before": preview = `${variableName} should be before ${comparisonName}`; suggestedRuleName = `${variableName} must be before ${comparisonName}`; suggestedMessage = `${variableName} must be before ${comparisonName}`; break;
        case "after": preview = `${variableName} should be after ${comparisonName}`; suggestedRuleName = `${variableName} must be after ${comparisonName}`; suggestedMessage = `${variableName} must be after ${comparisonName}`; break;
        case "on_or_after": preview = `${variableName} should be on or after ${comparisonName}`; suggestedRuleName = `${variableName} must be on or after ${comparisonName}`; suggestedMessage = `${variableName} must be on or after ${comparisonName}`; break;
        case "on_or_before": preview = `${variableName} should be on or before ${comparisonName}`; suggestedRuleName = `${variableName} must be on or before ${comparisonName}`; suggestedMessage = `${variableName} must be on or before ${comparisonName}`; break;
        case "within_before": if (intervalAmount && intervalUnit) { preview = `${variableName} should be within ${intervalAmount} ${intervalUnit} before ${comparisonName}`; suggestedRuleName = `${variableName} within ${intervalAmount} ${intervalUnit} before ${comparisonName}`; suggestedMessage = `${variableName} must be within ${intervalAmount} ${intervalUnit} before ${comparisonName}`; } break;
        case "within_after": if (intervalAmount && intervalUnit) { preview = `${variableName} should be within ${intervalAmount} ${intervalUnit} after ${comparisonName}`; suggestedRuleName = `${variableName} within ${intervalAmount} ${intervalUnit} after ${comparisonName}`; suggestedMessage = `${variableName} must be within ${intervalAmount} ${intervalUnit} after ${comparisonName}`; } break;
        }
    }
    document.getElementById("validationPreview").textContent = preview || "Configure the validation above to see preview";
    const ruleNameInput = document.getElementById("ruleName");
    const ruleMessageInput = document.getElementById("ruleMessage");
    if (suggestedRuleName && !ruleNameInput.value) { ruleNameInput.value = suggestedRuleName; M.updateTextFields(); }
    if (suggestedMessage && !ruleMessageInput.value) { ruleMessageInput.value = suggestedMessage; M.updateTextFields(); }
}

export function checkFormValidityCtx() {
    const operator = document.getElementById("validationOperator").value;
    const comparisonDate = document.getElementById("comparisonDate").value;
    const intervalAmount = document.getElementById("intervalAmount").value;
    const ruleName = document.getElementById("ruleName").value;
    const ruleMessage = document.getElementById("ruleMessage").value;
    let isValid = operator && comparisonDate && ruleName && ruleMessage;
    if ((operator === "within_before" || operator === "within_after") && !intervalAmount) isValid = false;
    document.getElementById("createValidationBtn").disabled = !isValid;
}

export function createValidationRuleCtx(ctx) {
    if (document.getElementById("createValidationBtn").disabled) return;
    const operator = document.getElementById("validationOperator").value;
    const comparisonDate = document.getElementById("comparisonDate").value;
    const intervalAmount = document.getElementById("intervalAmount").value;
    const intervalUnit = document.getElementById("intervalUnit").value;
    const ruleName = document.getElementById("ruleName").value;
    const ruleDescription = document.getElementById("ruleDescription").value;
    const ruleMessage = document.getElementById("ruleMessage").value;
    const validationConfig = { operator, comparisonDate, intervalAmount: intervalAmount ? parseInt(intervalAmount) : null, intervalUnit, ruleName, ruleDescription, ruleMessage };
    addValidationCtx(ctx, validationConfig);
}

export function loadCurrentValidationsCtx(ctx) {
    const { getCurrent, getMeta } = ctx;
    const variable = getCurrent(); if (!variable) return;
    const validations = detectExisting(getMeta(), variable);
    const container = document.getElementById("currentValidations");
    if (validations.length === 0) { container.innerHTML = "<p class='grey-text'>No validations configured for this date variable.</p>"; return; }
    container.innerHTML = validations.map(validation => {
        const action = validation.actions.find(a => ["SHOWWARNING", "SHOWERROR", "WARNINGONCOMPLETE", "ERRORONCOMPLETE"].includes(a.programRuleActionType));
        const actionType = action ? action.programRuleActionType : "UNKNOWN";
        const actionClass = actionType.includes("ERROR") ? "error" : "warning";
        return `
            <div class="validation-rule ${actionClass}">
                <h6>${validation.rule.name}</h6>
                <p><strong>Rule ID:</strong> <code>${validation.rule.id}</code></p>
                <p><strong>Condition:</strong> ${validation.rule.condition}</p>
                <p><strong>Action:</strong> ${actionType}</p>
                ${action?.content ? `<p><strong>Message:</strong> ${action.content}</p>` : ""}
                <div class="validation-actions">
                    <button class="btn-small red" onclick="deleteValidation('${validation.rule.id}')"><i class="material-icons left">delete</i>Delete</button>
                </div>
            </div>`;
    }).join("");
}

export function populateComparisonDatesCtx(ctx) {
    const { getCurrent, getDateVars } = ctx;
    const select = document.getElementById("comparisonDate"); if (!select) return;
    const instance = M.FormSelect.getInstance(select); if (instance) instance.destroy();
    select.innerHTML = "<option value=\"\" disabled selected>Choose date...</option>";
    const currentVariable = getCurrent(); const dateVariables = getDateVars();
    if (!currentVariable || !dateVariables) return;
    dateVariables.forEach(variable => {
        if (variable.id === currentVariable.id && variable.type === currentVariable.type && variable.stageId === currentVariable.stageId) return;
        let shouldInclude = false;
        if (variable.type === "current_date") { shouldInclude = true; }
        else if (currentVariable.type === "enrollment") { shouldInclude = variable.type === "incident" || variable.type === "trackedEntityAttribute"; }
        else if (currentVariable.type === "incident") { shouldInclude = variable.type === "enrollment" || variable.type === "trackedEntityAttribute"; }
        else if (currentVariable.type === "trackedEntityAttribute") { shouldInclude = variable.type === "enrollment" || variable.type === "incident"; }
        else if (currentVariable.type === "event_date") {
            if (["enrollment","incident","trackedEntityAttribute"].includes(variable.type)) shouldInclude = true;
            else if (variable.type === "dataElement") shouldInclude = variable.stageId === currentVariable.stageId;
        } else if (currentVariable.type === "dataElement") {
            if (["enrollment","incident","trackedEntityAttribute"].includes(variable.type)) shouldInclude = true;
            else if (variable.type === "dataElement") shouldInclude = variable.stageId === currentVariable.stageId;
        } else if (currentVariable.type === "current_date") { shouldInclude = true; }
        if (shouldInclude) { const option = document.createElement("option"); option.value = `${variable.type}:${variable.id}${variable.stageId ? ":" + variable.stageId : ""}`; option.textContent = variable.name; select.appendChild(option); }
    });
    M.FormSelect.init(select);
}

export async function addValidationCtx(ctx, config) {
    const { getCurrent, getMeta, getProgramId, getConfig } = ctx;
    const currentVariable = getCurrent(); if (!config || !currentVariable) { showMessage("Invalid configuration", "error"); return; }
    try {
        const [compareType, compareId, compareStageId] = config.comparisonDate.split(":");
        const compareDate = ctx.findByComponents(compareId, compareType, compareStageId);
        if (!compareDate) { showMessage("Target date not found", "error"); return; }
        const existingRule = getMeta().programRules.find(rule => rule.name === config.ruleName);
        if (existingRule) { showMessage(`A program rule with the name "${config.ruleName}" already exists. Please choose a different name.`, "error"); return; }
        const variable1Prv = await svcEnsurePrv(getMeta(), getProgramId(), getConfig()?.programRuleVariablePrefix, currentVariable);
        const variable2Prv = await svcEnsurePrv(getMeta(), getProgramId(), getConfig()?.programRuleVariablePrefix, compareDate);
        const ruleCondition = generateNewRuleCondition({ ...currentVariable, prvName: variable1Prv.name }, { ...compareDate, prvName: variable2Prv.name }, config);
        const programRule = { name: config.ruleName, description: config.ruleDescription || `Date validation rule for ${currentVariable.name}`, condition: ruleCondition, program: { id: getProgramId() }, priority: 1 };
        if (currentVariable.type === "dataElement" && currentVariable.stageId) programRule.programStage = { id: currentVariable.stageId };
        const programRuleAction = { programRuleActionType: "SHOWERROR", content: config.ruleMessage, program: { id: getProgramId() } };
        if (currentVariable.type === "dataElement") programRuleAction.dataElement = { id: currentVariable.id };
        else if (currentVariable.type === "trackedEntityAttribute") programRuleAction.trackedEntityAttribute = { id: currentVariable.id };
        await svcPrCreate(getMeta(), programRule, [programRuleAction], []);
        showMessage("Validation rule created successfully");
        loadCurrentValidationsCtx(ctx);
        setupValidationFormCtx(ctx);
    } catch (error) {
        console.error("Error creating validation rule:", error);
        showMessage("Error creating validation rule: " + (error.message || error), "error");
    }
}
