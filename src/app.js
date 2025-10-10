"use strict";

//CSS
import "materialize-css/dist/css/materialize.min.css";
import "./css/style.css";

//JS
import { d2Delete } from "./js/d2api.js";
import { loadLegacyHeaderBarIfNeeded } from "./js/check-header-bar.js";
import M from "materialize-css";
// Modularization: state, services, utilities
import { setState, getState, resetOnProgramChange } from "./js/state.js";
import { programsAllGet as svcProgramsAllGet, programGet as svcProgramGet, progGetConfig as svcProgGetConfig, progSetConfig as svcProgSetConfig } from "./js/services/program.js";
import { buildDateVariablesArray as dvBuild, findDateVariableByComponents as dvFindByComponents } from "./js/date-variables.js";
import { showMessage as uiToast } from "./js/ui/toast.js";
import { showOverview as uiShowOverview, renderDateVariables as uiRenderDateVariables } from "./js/ui/overview.js";
import { showVariableDetailsCtx as detailsShow, loadCurrentValidationsCtx as detailsLoadValidations, updateValidationPreviewCtx, checkFormValidityCtx, populateComparisonDatesCtx } from "./js/ui/details.js";
import { removeAppSignature, parseRuleCondition } from "./js/rules/signature.js";

loadLegacyHeaderBarIfNeeded();

// Initialize app when DOM is ready
document.addEventListener("DOMContentLoaded", initializeApp);

// Global variables
let currentProgram = null;
let programMetadata = null;
let currentVariable = null;
let programConfig = null;
let dateVariables = null;

// Initialize the application
function initializeApp() {
    // Initialize Materialize components
    M.Modal.init(document.querySelectorAll(".modal"));
    M.Collapsible.init(document.querySelectorAll(".collapsible"));
    // Set up event listeners
    setupEventListeners();
    // Load programs
    loadPrograms();
}

function setupEventListeners() {
    // Program selection
    document.getElementById("programSelect").addEventListener("change", onProgramSelected);
    // Settings button
    document.getElementById("settingsBtn").addEventListener("click", openSettingsModal);
    // Save settings
    document.getElementById("saveSettingsBtn").addEventListener("click", saveSettings);
    // Back to overview
    const backButton = document.getElementById("backToOverview");
    if (backButton) backButton.addEventListener("click", showOverview);
}

function showMessage(message, type = "success") {
    // Proxy to modular toast util
    if (typeof uiToast === "function") return uiToast(message, type);
    const toastClass = type === "error" ? "red" : "green";
    const iconClass = type === "error" ? "error" : "check_circle";
    M.toast({ html: `<i class="material-icons left">${iconClass}</i>${message}`, classes: toastClass, displayLength: 4000 });
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
    // Show loading
    document.getElementById("loadingIndicator").style.display = "block";
    document.getElementById("dateVariablesOverview").style.display = "none";
    document.getElementById("dateVariableDetails").style.display = "none";
    try {
        // Load program config
        programConfig = await svcProgGetConfig(programId);
        setState({ programConfig });
        // Load program metadata
        programMetadata = await svcProgramGet(programId);
        setState({ programMetadata });
        // Build date variables array from metadata
        dateVariables = dvBuild();
        setState({ dateVariables });
        // Show overview
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

// Overview UI moved to ./js/ui/overview.js

function buildDetailsCtx() {
    return {
        setCurrent: (v) => { currentVariable = v; setState({ currentVariable: v }); },
        getCurrent: () => {
            const current = currentVariable || getState().currentVariable;
            return current;
        },
        getMeta: () => programMetadata || getState().programMetadata,
        setMeta: (meta) => { programMetadata = meta; setState({ programMetadata: meta }); },
        getDateVars: () => {
            const dateVars = dateVariables || getState().dateVariables;
            return dateVars;
        },
        findByComponents: (id, type, stageId) => dvFindByComponents(id, type, stageId),
        getProgramId: () => currentProgram || getState().currentProgram,
        getConfig: () => programConfig || getState().programConfig
    };
}

function showVariableDetails(variable) {
    detailsShow(buildDetailsCtx(), variable);
}

// Expose for overview click callbacks (avoids circular deps)
window.__showVariableDetails = showVariableDetails;

function loadCurrentValidations() { detailsLoadValidations(buildDetailsCtx()); }

// Global function for delete validation (called from HTML)
window.deleteValidation = async function(ruleId) {
    if (!confirm("Are you sure you want to delete this validation rule?")) return;
    try {
        await d2Delete(`programRules/${ruleId}`);
        showMessage("Validation rule deleted successfully");
        
        // Refresh metadata from server to ensure we have the latest state
        programMetadata = await svcProgramGet(currentProgram);
        setState({ programMetadata });
        
        // Refresh display
        loadCurrentValidations();
    } catch (error) {
        console.error("Error deleting validation:", error);
        showMessage("Error deleting validation: " + error.message, "error");
    }
};

// Global function for edit validation (called from HTML)
window.editValidation = async function(ruleId) {
    try {
        const rule = programMetadata.programRules.find(r => r.id === ruleId);
        if (!rule) {
            showMessage("Rule not found", "error");
            return;
        }
        
        const actions = programMetadata.programRuleActions.filter(a => a.programRule.id === ruleId);
        const action = actions.find(a => ["SHOWWARNING", "SHOWERROR", "WARNINGONCOMPLETE", "ERRORONCOMPLETE"].includes(a.programRuleActionType));
        
        if (!action) {
            showMessage("No editable action found for this rule", "error");
            return;
        }
        
        // Parse the rule condition to populate the form
        const ruleConfig = parseRuleCondition(rule.condition, programMetadata);
        if (!ruleConfig) {
            showMessage("Cannot parse rule condition for editing", "error");
            return;
        }
        
        const { variable1, variable2, config } = ruleConfig;
        
        // Set the current variable being validated (variable1)
        currentVariable = variable1;
                    // Declare comparisonValue at the top so it is always initialized
                    let comparisonValue = "";
        setState({ currentVariable: variable1 });
        // Show the variable details for the current variable (this will reset the form)
        detailsShow(buildDetailsCtx(), variable1);
        // Set validated variable name in UI
        document.getElementById("validatedDateName").textContent = variable1.name || "";
        // Change "Add New Validation" to "Edit program rule" when editing
        document.querySelector("#dateVariableDetails .card-title:last-of-type").textContent = "Edit program rule";
        // Create comparison value for the form
        // Only declare comparisonValue once at the top of the function, then set its value here
        if (variable2.type === "enrollment") comparisonValue = "enrollment:enrollment_date";
        else if (variable2.type === "incident") comparisonValue = "incident:incident_date";
        else if (variable2.type === "event_date") comparisonValue = "event_date:event_date";
        else if (variable2.type === "current_date") comparisonValue = "current_date:current_date";
        else if (variable2.type === "dataElement") {
            comparisonValue = `dataElement:${variable2.id}${variable2.stageId ? ":" + variable2.stageId : ""}`;
        } else if (variable2.type === "trackedEntityAttribute") {
            comparisonValue = `trackedEntityAttribute:${variable2.id}`;
        }
        // Set all form fields
        document.getElementById("validationOperator").value = config.operator;
        document.getElementById("comparisonDate").value = comparisonValue;
        if (config.intervalAmount && config.intervalUnit) {
            document.getElementById("intervalAmount").value = config.intervalAmount;
            document.getElementById("intervalUnit").value = config.intervalUnit;
        }
        document.getElementById("ruleName").value = rule.name;
        document.getElementById("ruleDescription").value = removeAppSignature(rule.description || "");
        document.getElementById("ruleMessage").value = action.content || "";
        // Trigger relationship dropdown change to show interval fields if needed
        const operatorEl = document.getElementById("validationOperator");
        operatorEl.dispatchEvent(new Event("change"));
        // Update preview and validity
        updateValidationPreviewCtx(buildDetailsCtx());
        checkFormValidityCtx(buildDetailsCtx());
        
        // Now populate the form AFTER detailsShow has reset everything
        // Store the rule ID for updating instead of creating (this gets reset by detailsShow)
        window.editingRuleId = ruleId;
        M.updateTextFields();
        
        // Repopulate comparison dates now that the current variable is set
        populateComparisonDatesCtx(buildDetailsCtx());
        
        // Set the comparison date value again after repopulating
        document.getElementById("comparisonDate").value = comparisonValue;
        M.FormSelect.init(document.querySelectorAll("#dateVariableDetails select"));
        
        // Update preview and validity
        updateValidationPreviewCtx(buildDetailsCtx());
        checkFormValidityCtx(buildDetailsCtx());
        
        // Update button text (gets reset by detailsShow)
        const createBtn = document.getElementById("createValidationBtn");
        createBtn.innerHTML = "<i class=\"material-icons left\">save</i>Update Validation Rule";
        
        showMessage("Rule loaded for editing", "info");
        
    } catch (error) {
        console.error("Error loading rule for editing:", error);
        showMessage("Error loading rule for editing: " + error.message, "error");
    }
};

function openSettingsModal() {
    const modal = M.Modal.getInstance(document.getElementById("settingsModal"));
    // Populate current settings
    if (programConfig) {
        document.getElementById("programRulePrefix").value = programConfig.programRulePrefix || "";
        document.getElementById("programRuleVariablePrefix").value = programConfig.programRuleVariablePrefix || "";
        M.updateTextFields();
    }
    modal.open();
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
        const modal = M.Modal.getInstance(document.getElementById("settingsModal"));
        modal.close();
        // Refresh the overview to update settings warning
        if (document.getElementById("dateVariablesOverview").style.display !== "none") {
            showOverview();
        }
    } catch (error) {
        console.error("Error saving settings:", error);
        showMessage("Error saving settings: " + error.message, "error");
    }
}
