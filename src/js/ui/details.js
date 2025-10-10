import M from "materialize-css";
import { prGetExisting as detectExisting } from "../rules/detector.js";
import { generateNewRuleCondition, generateRuleName } from "../rules/builder.js";
import { isAppGenerated, addAppSignature, findDuplicateRule } from "../rules/signature.js";
import { ensureProgramRuleVariable as svcEnsurePrv, prCreate as svcPrCreate } from "../services/rules.js";
import { programGet as svcProgramGet } from "../services/program.js";
import { buildDateVariablesArray as dvBuild } from "../date-variables.js";
import { d2PutJson } from "../d2api.js";
import { showMessage } from "./toast.js";

async function refreshMetadata(ctx) {
    const { getProgramId, setMeta } = ctx;
    try {
        const refreshedMetadata = await svcProgramGet(getProgramId());
        setMeta(refreshedMetadata);
        // Rebuild date variables with new metadata
        dvBuild();
        console.log("Metadata refreshed, found", (refreshedMetadata.programRules || []).length, "rules");
        return refreshedMetadata;
    } catch (error) {
        console.error("Error refreshing metadata:", error);
        showMessage("Error refreshing metadata: " + error.message, "error");
        return null;
    }
}

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
    // Clean up any existing Materialize instances and event listeners on selects
    const existingSelects = document.querySelectorAll("#dateVariableDetails select");
    existingSelects.forEach(select => {
        const inst = M.FormSelect.getInstance(select);
        if (inst) inst.destroy();
        // Replace node to drop any existing event listeners
        const clone = select.cloneNode(true);
        select.parentNode.replaceChild(clone, select);
    });

    document.getElementById("validationOperator").value = "";
    document.getElementById("comparisonDate").value = "";
    document.getElementById("intervalInputs").style.display = "none";
    document.getElementById("intervalAmount").value = "";
    document.getElementById("intervalUnit").value = "days";
    document.getElementById("createValidationBtn").disabled = true;
    document.getElementById("ruleName").value = "";
    document.getElementById("ruleDescription").value = "";
    document.getElementById("ruleMessage").value = "";
    
    // Reset edit mode
    window.editingRuleId = null;
    document.getElementById("createValidationBtn").innerHTML = "<i class=\"material-icons left\">add</i>Create Validation Rule";
    
    populateComparisonDatesCtx(ctx);
    setupFormEventListenersCtx(ctx);
    // Initialize Materialize selects once
    const allSelects = document.querySelectorAll("#dateVariableDetails select");
    M.FormSelect.init(allSelects);
}

export function setupFormEventListenersCtx(ctx) {
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
        checkFormValidityCtx(ctx);
    };
    const operatorEl = document.getElementById("validationOperator");
    operatorEl.addEventListener("change", handleOperatorChange);
    operatorEl.addEventListener("click", function(){ setTimeout(handleOperatorChange.bind(this), 100); });
    ["comparisonDate", "intervalAmount", "intervalUnit", "ruleName", "ruleDescription", "ruleMessage"].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener("change", () => { updateValidationPreviewCtx(ctx); checkFormValidityCtx(ctx); });
            el.addEventListener("input", () => { updateValidationPreviewCtx(ctx); checkFormValidityCtx(ctx); });
        }
    });
    const createBtn = document.getElementById("createValidationBtn");
    if (createBtn) {
        // Remove any existing event listeners by cloning the node
        const newCreateBtn = createBtn.cloneNode(true);
        createBtn.parentNode.replaceChild(newCreateBtn, createBtn);
        // Add the event listener to the new node
        newCreateBtn.addEventListener("click", () => createValidationRuleCtx(ctx));
    }
}

export function updateValidationPreviewCtx(ctx) {
    const { getCurrent } = ctx;
    const operator = document.getElementById("validationOperator").value;
    const comparisonDate = document.getElementById("comparisonDate").value;
    const intervalAmount = document.getElementById("intervalAmount").value;
    const intervalUnit = document.getElementById("intervalUnit").value;
    let preview = ""; let suggestedRuleName = ""; let suggestedMessage = ""; let suggestedDescription = "";
    if (operator && comparisonDate) {
        const variableName = getCurrent().name;
        const comparisonOption = document.querySelector(`#comparisonDate option[value="${comparisonDate}"]`);
        const comparisonName = comparisonOption ? comparisonOption.textContent : "";
        switch (operator) {
        case "before": 
            preview = `${variableName} should be before ${comparisonName}`; 
            suggestedRuleName = `${variableName} must be before ${comparisonName}`; 
            suggestedMessage = `${variableName} must be before ${comparisonName}`;
            suggestedDescription = `Validates that ${variableName} is entered before ${comparisonName}`;
            break;
        case "after": 
            preview = `${variableName} should be after ${comparisonName}`; 
            suggestedRuleName = `${variableName} must be after ${comparisonName}`; 
            suggestedMessage = `${variableName} must be after ${comparisonName}`;
            suggestedDescription = `Validates that ${variableName} is entered after ${comparisonName}`;
            break;
        case "on_or_after": 
            preview = `${variableName} should be on or after ${comparisonName}`; 
            suggestedRuleName = `${variableName} must be on or after ${comparisonName}`; 
            suggestedMessage = `${variableName} must be on or after ${comparisonName}`;
            suggestedDescription = `Validates that ${variableName} is on the same date or after ${comparisonName}`;
            break;
        case "on_or_before": 
            preview = `${variableName} should be on or before ${comparisonName}`; 
            suggestedRuleName = `${variableName} must be on or before ${comparisonName}`; 
            suggestedMessage = `${variableName} must be on or before ${comparisonName}`;
            suggestedDescription = `Validates that ${variableName} is on the same date or before ${comparisonName}`;
            break;
        case "within_before": 
            if (intervalAmount && intervalUnit) { 
                preview = `${variableName} should be within ${intervalAmount} ${intervalUnit} before ${comparisonName}`; 
                suggestedRuleName = `${variableName} within ${intervalAmount} ${intervalUnit} before ${comparisonName}`; 
                suggestedMessage = `${variableName} must be within ${intervalAmount} ${intervalUnit} before ${comparisonName}`;
                suggestedDescription = `Validates that ${variableName} is no more than ${intervalAmount} ${intervalUnit} before ${comparisonName}`;
            } 
            break;
        case "within_after": 
            if (intervalAmount && intervalUnit) { 
                preview = `${variableName} should be within ${intervalAmount} ${intervalUnit} after ${comparisonName}`; 
                suggestedRuleName = `${variableName} within ${intervalAmount} ${intervalUnit} after ${comparisonName}`; 
                suggestedMessage = `${variableName} must be within ${intervalAmount} ${intervalUnit} after ${comparisonName}`;
                suggestedDescription = `Validates that ${variableName} is no more than ${intervalAmount} ${intervalUnit} after ${comparisonName}`;
            } 
            break;
        }
    }
    document.getElementById("validationPreview").textContent = preview || "Configure the validation above to see preview";
    const ruleNameInput = document.getElementById("ruleName");
    const ruleDescriptionInput = document.getElementById("ruleDescription");
    const ruleMessageInput = document.getElementById("ruleMessage");
    if (suggestedRuleName && !ruleNameInput.value) { ruleNameInput.value = suggestedRuleName; M.updateTextFields(); }
    if (suggestedDescription && !ruleDescriptionInput.value) { ruleDescriptionInput.value = suggestedDescription; M.updateTextFields(); }
    if (suggestedMessage && !ruleMessageInput.value) { ruleMessageInput.value = suggestedMessage; M.updateTextFields(); }
}

export function checkFormValidityCtx(ctx) {
    // First check if program settings are configured
    const { getConfig } = ctx;
    const config = getConfig();
    
    const settingsValid = config && config.programRuleVariablePrefix && config.programRuleVariablePrefix.trim().length > 0;
    
    if (!settingsValid) {
        document.getElementById("createValidationBtn").disabled = true;
        // Show settings requirement message
        const validationPreview = document.getElementById("validationPreview");
        if (validationPreview) {
            validationPreview.innerHTML = "<div class=\"red-text\"><i class=\"material-icons tiny\">warning</i> Please configure program settings first by clicking the <strong>Settings</strong> button above.</div>";
        }
        return;
    }
    
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
    
    // Check if we're in edit mode
    if (window.editingRuleId) {
        updateValidationCtx(ctx, validationConfig, window.editingRuleId);
    } else {
        addValidationCtx(ctx, validationConfig);
    }
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
        const isEditable = isAppGenerated(validation.rule);
        const displayName = validation.rule.name;
        
        return `
            <div class="validation-rule ${actionClass}">
                <h6>${displayName}</h6>
                <p><strong>Rule ID:</strong> <code>${validation.rule.id}</code></p>
                <p><strong>Condition:</strong> ${validation.rule.condition}</p>
                <p><strong>Action:</strong> ${actionType}</p>
                ${action?.content ? `<p><strong>Message:</strong> ${action.content}</p>` : ""}
                <div class="validation-actions">
                    ${isEditable ? `<button class="btn-small blue" onclick="editValidation('${validation.rule.id}')"><i class="material-icons left">edit</i>Edit</button>` : ""}
                    <button class="btn-small red" onclick="deleteValidation('${validation.rule.id}')"><i class="material-icons left">delete</i>Delete</button>
                </div>
            </div>`;
    }).join("");
}

export function populateComparisonDatesCtx(ctx) {
    const { getCurrent, getDateVars } = ctx;
    const select = document.getElementById("comparisonDate"); if (!select) return;
    select.innerHTML = "<option value=\"\" disabled selected>Choose date...</option>";
    const currentVariable = getCurrent(); const dateVariables = getDateVars();
    
    if (!currentVariable || !dateVariables) return;
    dateVariables.forEach(variable => {
        // Skip if this is the same variable as the one being validated
        if (variable.id === currentVariable.id && 
            (variable.type === currentVariable.type || 
             (variable.type === "dataElement" && currentVariable.type === "data_element") ||
             (variable.type === "data_element" && currentVariable.type === "dataElement")) && 
            variable.stageId === currentVariable.stageId) return;
        let shouldInclude = false;
        
        if (variable.type === "current_date") { shouldInclude = true; }
        else if (currentVariable.type === "enrollment") { shouldInclude = variable.type === "incident" || variable.type === "trackedEntityAttribute"; }
        else if (currentVariable.type === "incident") { shouldInclude = variable.type === "enrollment" || variable.type === "trackedEntityAttribute"; }
        else if (currentVariable.type === "trackedEntityAttribute") { shouldInclude = variable.type === "enrollment" || variable.type === "incident"; }
        else if (currentVariable.type === "event_date") {
            if (["enrollment","incident","trackedEntityAttribute"].includes(variable.type)) shouldInclude = true;
            else if (variable.type === "dataElement" || variable.type === "data_element") shouldInclude = variable.stageId === currentVariable.stageId;
        } else if (currentVariable.type === "dataElement" || currentVariable.type === "data_element") {
            if (["enrollment","incident","trackedEntityAttribute"].includes(variable.type)) shouldInclude = true;
            else if (variable.type === "event_date") shouldInclude = variable.stageId === currentVariable.stageId;
            else if (variable.type === "dataElement" || variable.type === "data_element") shouldInclude = variable.stageId === currentVariable.stageId;
        } else if (currentVariable.type === "current_date") { shouldInclude = true; }
        
        if (shouldInclude) { const option = document.createElement("option"); option.value = `${variable.type}:${variable.id}${variable.stageId ? ":" + variable.stageId : ""}`; option.textContent = variable.name; select.appendChild(option); }
    });
}

function generateDefaultDescription(variable1, variable2, operator, intervalAmount, intervalUnit) {
    const var1Name = variable1.name;
    const var2Name = variable2.name;
    
    switch (operator) {
    case "before":
        return `Validates that ${var1Name} is entered before ${var2Name}`;
    case "after":
        return `Validates that ${var1Name} is entered after ${var2Name}`;
    case "on_or_after":
        return `Validates that ${var1Name} is on the same date or after ${var2Name}`;
    case "on_or_before":
        return `Validates that ${var1Name} is on the same date or before ${var2Name}`;
    case "within_before":
        return `Validates that ${var1Name} is no more than ${intervalAmount} ${intervalUnit} before ${var2Name}`;
    case "within_after":
        return `Validates that ${var1Name} is no more than ${intervalAmount} ${intervalUnit} after ${var2Name}`;
    default:
        return `Date validation rule for ${var1Name}`;
    }
}

export async function addValidationCtx(ctx, config) {
    const { getCurrent, getMeta, getProgramId, getConfig } = ctx;
    const currentVariable = getCurrent(); if (!config || !currentVariable) { showMessage("Invalid configuration", "error"); return; }
    try {
        // Check for duplicates
        const [compareType, compareId, compareStageId] = config.comparisonDate.split(":");
        const compareDate = ctx.findByComponents(compareId, compareType, compareStageId);
        if (!compareDate) { showMessage("Target date not found", "error"); return; }
        
        const duplicateRule = findDuplicateRule(getMeta(), currentVariable, config);
        if (duplicateRule) {
            showMessage(`A validation rule comparing these same date variables already exists: "${duplicateRule.name}". Please choose different variables or modify the existing rule.`, "error");
            return;
        }
        
        // Generate the final rule name to check for collisions
        const finalRuleName = generateRuleName(currentVariable, compareDate, config.operator, config.ruleName);
        const existingRule = getMeta().programRules.find(rule => rule.name === finalRuleName);
        if (existingRule) { 
            showMessage(`A program rule with the name "${finalRuleName}" already exists. Please choose a different name.`, "error"); 
            return; 
        }
        
        const variable1Prv = await svcEnsurePrv(getMeta(), getProgramId(), getConfig()?.programRuleVariablePrefix, currentVariable);
    const variable2Prv = await svcEnsurePrv(getMeta(), getProgramId(), getConfig()?.programRuleVariablePrefix, compareDate);
        
    const prefix = getConfig()?.programRuleVariablePrefix || "";
    const ruleCondition = generateNewRuleCondition({ ...currentVariable, prvName: variable1Prv.name }, { ...compareDate, prvName: variable2Prv.name }, config);
        
    // Generate rule name and description with signature
    // Format rule name: [prefix] - [Actual name]
    let actualName = generateRuleName(currentVariable, compareDate, config.operator, config.ruleName);
    let ruleName = prefix ? `${prefix} - ${actualName}` : actualName;
    const defaultDesc = generateDefaultDescription(currentVariable, compareDate, config.operator, config.intervalAmount, config.intervalUnit);
    let desc = config.ruleDescription || defaultDesc;
    if (!desc.startsWith("[DVT]")) desc = `[DVT] ${desc}`;
    const { description } = addAppSignature(ruleName, desc);

    const programRule = { name: ruleName, description, condition: ruleCondition, program: { id: getProgramId() }, priority: 1 };
    if ((currentVariable.type === "dataElement" || currentVariable.type === "data_element") && currentVariable.stageId) programRule.programStage = { id: currentVariable.stageId };
    const programRuleAction = { programRuleActionType: "SHOWERROR", content: config.ruleMessage, program: { id: getProgramId() } };
    if (currentVariable.type === "dataElement" || currentVariable.type === "data_element") programRuleAction.dataElement = { id: currentVariable.id };
    else if (currentVariable.type === "trackedEntityAttribute" || currentVariable.type === "attribute") programRuleAction.trackedEntityAttribute = { id: currentVariable.id };

    await svcPrCreate(getMeta(), programRule, [programRuleAction], []);

    showMessage("Validation rule created successfully");
        
        // Refresh metadata from server to ensure we have the latest state
        const refreshedMetadata = await refreshMetadata(ctx);
        if (refreshedMetadata) {
            loadCurrentValidationsCtx(ctx);
        }
        
        setupValidationFormCtx(ctx);
    } catch (error) {
        console.error("Error creating validation rule:", error);
        showMessage("Error creating validation rule: " + (error.message || error), "error");
    }
}

export async function updateValidationCtx(ctx, config, ruleId) {
    const { getCurrent, getMeta, getProgramId, getConfig } = ctx;
    const currentVariable = getCurrent(); if (!config || !currentVariable || !ruleId) { showMessage("Invalid configuration", "error"); return; }
    try {
        const [compareType, compareId, compareStageId] = config.comparisonDate.split(":");
        const compareDate = ctx.findByComponents(compareId, compareType, compareStageId);
        if (!compareDate) { showMessage("Target date not found", "error"); return; }
        
        // Find the existing rule and action
        const existingRule = getMeta().programRules.find(r => r.id === ruleId);
        const existingActions = getMeta().programRuleActions.filter(a => a.programRule.id === ruleId);
        const existingAction = existingActions.find(a => ["SHOWWARNING", "SHOWERROR", "WARNINGONCOMPLETE", "ERRORONCOMPLETE"].includes(a.programRuleActionType));
        
        if (!existingRule || !existingAction) {
            showMessage("Rule or action not found for updating", "error");
            return;
        }
        
        // Check for duplicates (excluding the current rule)
        const duplicateRule = findDuplicateRule(getMeta(), currentVariable, config);
        if (duplicateRule && duplicateRule.id !== ruleId) {
            showMessage(`A validation rule comparing these same date variables already exists: "${duplicateRule.name}". Please choose different variables or modify the existing rule.`, "error");
            return;
        }
        
        // Generate the final rule name to check for collisions (excluding current rule)
        const finalRuleName = generateRuleName(currentVariable, compareDate, config.operator, config.ruleName);
        const duplicateName = getMeta().programRules.find(rule => rule.name === finalRuleName && rule.id !== ruleId);
        if (duplicateName) { 
            showMessage(`A program rule with the name "${finalRuleName}" already exists. Please choose a different name.`, "error"); 
            return; 
        }
        // Pass variable prefix for PRV name formatting
    const variablePrefix = getConfig()?.programRuleVariablePrefix ? getConfig().programRuleVariablePrefix.replace(/-/g, "_").toUpperCase() : "";
    const variable1Prv = await svcEnsurePrv(getMeta(), getProgramId(), variablePrefix, currentVariable);
    const variable2Prv = await svcEnsurePrv(getMeta(), getProgramId(), variablePrefix, compareDate);
    const ruleCondition = generateNewRuleCondition({ ...currentVariable, prvName: variable1Prv.name }, { ...compareDate, prvName: variable2Prv.name }, config);

    // Generate rule name and description with signature
    // Format rule name: [prefix] - [Actual name]
    let actualName = generateRuleName(currentVariable, compareDate, config.operator, config.ruleName);
    let ruleName = getConfig()?.programRuleNamePrefix ? `${getConfig().programRuleNamePrefix} - ${actualName}` : actualName;
    const defaultDesc = generateDefaultDescription(currentVariable, compareDate, config.operator, config.intervalAmount, config.intervalUnit);
    const { description } = addAppSignature(ruleName, config.ruleDescription || defaultDesc);
        
        // Update the rule
        const updatedRule = { 
            ...existingRule,
            name: ruleName, 
            description, 
            condition: ruleCondition 
        };
        
        // Update the action
        const updatedAction = {
            ...existingAction,
            content: config.ruleMessage
        };
        
        // Send updates to DHIS2
        await d2PutJson(`/api/programRules/${ruleId}`, updatedRule);
        await d2PutJson(`/api/programRuleActions/${existingAction.id}`, updatedAction);
        
        showMessage("Validation rule updated successfully");
        
        // Refresh metadata from server to ensure we have the latest state
        const refreshedMetadata = await refreshMetadata(ctx);
        if (refreshedMetadata) {
            loadCurrentValidationsCtx(ctx);
        }
        
        setupValidationFormCtx(ctx);
    } catch (error) {
        console.error("Error updating validation rule:", error);
        showMessage("Error updating validation rule: " + (error.message || error), "error");
    }
}
