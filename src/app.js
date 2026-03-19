"use strict";

//CSS
import "./css/style.css";

//JS
import { d2Delete } from "./js/d2api.js";
import { loadLegacyHeaderBarIfNeeded } from "./js/check-header-bar.js";
import { setState, getState, resetOnProgramChange } from "./js/state.js";
import { programsAllGet as svcProgramsAllGet, programGet as svcProgramGet, progGetConfig as svcProgGetConfig, progSetConfig as svcProgSetConfig } from "./js/services/program.js";
import { buildVariablesArray as dvBuild, findVariableByComponents as dvFindByComponents } from "./js/variables.js";
import { showMessage as uiToast } from "./js/ui/toast.js";
import { showOverview as uiShowOverview, renderDateVariables as uiRenderDateVariables } from "./js/ui/overview.js";
import { showVariableDetailsCtx as detailsShow, loadCurrentValidationsCtx as detailsLoadValidations, updateValidationPreviewCtx, checkFormValidityCtx, populateComparisonOptionsCtx } from "./js/ui/details.js";
import { removeAppSignature, parseRuleCondition } from "./js/rules/signature.js";

loadLegacyHeaderBarIfNeeded();

document.addEventListener("DOMContentLoaded", initializeApp);

let currentProgram = null;
let programMetadata = null;
let currentVariable = null;
let programConfig = null;
let dateVariables = null;

function initializeApp() {
    setupEventListeners();
    loadPrograms();
}

function setupEventListeners() {
    document.getElementById("programSelect").addEventListener("change", onProgramSelected);
    document.getElementById("settingsBtn").addEventListener("click", openSettingsModal);
    document.getElementById("saveSettingsBtn").addEventListener("click", saveSettings);
    document.getElementById("settingsModalClose").addEventListener("click", closeSettingsModal);
    document.getElementById("settingsModalCancel").addEventListener("click", closeSettingsModal);
    // Close modal on overlay click
    document.getElementById("settingsModal").addEventListener("click", function(e) {
        if (e.target === this) closeSettingsModal();
    });
    const backButton = document.getElementById("backToOverview");
    if (backButton) backButton.addEventListener("click", showOverview);
}

function showMessage(message, type = "success") {
    uiToast(message, type);
}

async function loadPrograms() {
    try {
        const programs = await svcProgramsAllGet();
        populateProgramSelect(programs);
    } catch (error) {
        console.error("Error loading programs:", error);
        showMessage("Error loading programs: " + error.message, "error");
    }
}

function populateProgramSelect(programs) {
    const select = document.getElementById("programSelect");
    select.innerHTML = "<option value=\"\" disabled selected>Select a tracker programme...</option>";
    programs.forEach(program => {
        const option = document.createElement("option");
        option.value = program.id;
        option.textContent = program.name;
        select.appendChild(option);
    });
}

async function onProgramSelected() {
    const programId = document.getElementById("programSelect").value;
    if (!programId) return;
    currentProgram = programId;
    resetOnProgramChange(programId);
    document.getElementById("loadingIndicator").style.display = "block";
    document.getElementById("dateVariablesOverview").style.display = "none";
    document.getElementById("dateVariableDetails").style.display = "none";
    try {
        programConfig = await svcProgGetConfig(programId);
        setState({ programConfig });
        programMetadata = await svcProgramGet(programId);
        setState({ programMetadata });
        dateVariables = dvBuild();
        setState({ dateVariables });
        showOverview();
    } catch (error) {
        console.error("Error loading program:", error);
        showMessage("Error loading program: " + error.message, "error");
    } finally {
        document.getElementById("loadingIndicator").style.display = "none";
    }
}

function showOverview() {
    uiShowOverview();
    uiRenderDateVariables(programMetadata, programConfig);
}

function buildDetailsCtx() {
    return {
        setCurrent: (v) => { currentVariable = v; setState({ currentVariable: v }); },
        getCurrent: () => currentVariable || getState().currentVariable,
        getMeta: () => programMetadata || getState().programMetadata,
        setMeta: (meta) => { programMetadata = meta; setState({ programMetadata: meta }); },
        getDateVars: () => dateVariables || getState().dateVariables,
        findByComponents: (id, type, stageId) => dvFindByComponents(id, type, stageId),
        getProgramId: () => currentProgram || getState().currentProgram,
        getConfig: () => programConfig || getState().programConfig
    };
}

function showVariableDetails(variable) {
    detailsShow(buildDetailsCtx(), variable);
}

window.__showVariableDetails = showVariableDetails;

function loadCurrentValidations() { detailsLoadValidations(buildDetailsCtx()); }

window.deleteValidation = async function(ruleId) {
    if (!confirm("Are you sure you want to delete this validation rule?")) return;
    try {
        await d2Delete(`programRules/${ruleId}`);
        showMessage("Validation rule deleted successfully");
        programMetadata = await svcProgramGet(currentProgram);
        setState({ programMetadata });
        loadCurrentValidations();
    } catch (error) {
        console.error("Error deleting validation:", error);
        showMessage("Error deleting validation: " + error.message, "error");
    }
};

window.editValidation = async function(ruleId) {
    try {
        const rule = programMetadata.programRules.find(r => r.id === ruleId);
        if (!rule) { showMessage("Rule not found", "error"); return; }

        const actions = programMetadata.programRuleActions.filter(a => a.programRule.id === ruleId);
        const action = actions.find(a => ["SHOWWARNING", "SHOWERROR", "WARNINGONCOMPLETE", "ERRORONCOMPLETE"].includes(a.programRuleActionType));

        if (!action) { showMessage("No editable action found for this rule", "error"); return; }

        const ruleConfig = parseRuleCondition(rule.condition, programMetadata, currentVariable);
        if (!ruleConfig) { showMessage("Cannot parse rule condition for editing", "error"); return; }

        const { variable1, variable2, config } = ruleConfig;

        currentVariable = variable1;
        let comparisonValue = "";
        setState({ currentVariable: variable1 });
        document.getElementById("variableDetailsTitle").textContent = `${variable1 && variable1.name ? variable1.name : ""} - Validation Settings`;

        detailsShow(buildDetailsCtx(), variable1);
        document.getElementById("validatedDateName").textContent = variable1.name || "";

        // Update form title for edit mode
        document.getElementById("newValidationFormTitle").textContent = "Edit program rule";

        if (variable2.type === "enrollment") comparisonValue = "enrollment:enrollment_date";
        else if (variable2.type === "incident") comparisonValue = "incident:incident_date";
        else if (variable2.type === "event_date") comparisonValue = "event_date:event_date";
        else if (variable2.type === "current_date") comparisonValue = "current_date:current_date";
        else if (variable2.type === "dataElement") {
            comparisonValue = `dataElement:${variable2.id}${variable2.stageId ? ":" + variable2.stageId : ""}`;
        } else if (variable2.type === "trackedEntityAttribute") {
            comparisonValue = `trackedEntityAttribute:${variable2.id}`;
        }

        document.getElementById("validationOperator").value = config.operator;
        document.getElementById("comparisonDate").value = comparisonValue;
        if (config.intervalAmount && config.intervalUnit) {
            document.getElementById("intervalAmount").value = config.intervalAmount;
            document.getElementById("intervalUnit").value = config.intervalUnit;
        }
        document.getElementById("ruleName").value = rule.name;
        document.getElementById("ruleDescription").value = removeAppSignature(rule.description || "");
        document.getElementById("ruleMessage").value = action.content || "";
        document.getElementById("actionType").value = action.programRuleActionType || "SHOWERROR";

        const operatorEl = document.getElementById("validationOperator");
        operatorEl.dispatchEvent(new Event("change"));
        updateValidationPreviewCtx(buildDetailsCtx());
        checkFormValidityCtx(buildDetailsCtx());

        window.editingRuleId = ruleId;

        populateComparisonOptionsCtx(buildDetailsCtx());
        document.getElementById("comparisonDate").value = comparisonValue;

        updateValidationPreviewCtx(buildDetailsCtx());
        checkFormValidityCtx(buildDetailsCtx());

        const createBtn = document.getElementById("createValidationBtn");
        createBtn.textContent = "Update Validation Rule";

        showMessage("Rule loaded for editing", "info");

    } catch (error) {
        console.error("Error loading rule for editing:", error);
        showMessage("Error loading rule for editing: " + error.message, "error");
    }
};

function openSettingsModal() {
    if (programConfig) {
        document.getElementById("programRulePrefix").value = programConfig.programRulePrefix || "";
        document.getElementById("programRuleVariablePrefix").value = programConfig.programRuleVariablePrefix || "";
    }
    document.getElementById("settingsModal").classList.add("open");
}

function closeSettingsModal() {
    document.getElementById("settingsModal").classList.remove("open");
}

async function saveSettings() {
    const prefix = document.getElementById("programRulePrefix").value;
    const variablePrefix = document.getElementById("programRuleVariablePrefix").value;
    const config = { programRulePrefix: prefix, programRuleVariablePrefix: variablePrefix };
    try {
        await svcProgSetConfig(currentProgram, config);
        programConfig = config;
        setState({ programConfig });
        showMessage("Settings saved successfully");
        closeSettingsModal();
        if (document.getElementById("dateVariablesOverview").style.display !== "none") {
            showOverview();
        }
    } catch (error) {
        console.error("Error saving settings:", error);
        showMessage("Error saving settings: " + error.message, "error");
    }
}
