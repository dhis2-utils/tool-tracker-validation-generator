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
import { showVariableDetailsCtx as detailsShow, loadCurrentValidationsCtx as detailsLoadValidations } from "./js/ui/details.js";

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
    uiRenderDateVariables(programMetadata);
}

// Overview UI moved to ./js/ui/overview.js

function buildDetailsCtx() {
    return {
        setCurrent: (v) => { currentVariable = v; setState({ currentVariable: v }); },
        getCurrent: () => currentVariable || getState().currentVariable,
        getMeta: () => programMetadata || getState().programMetadata,
        getDateVars: () => dateVariables || getState().dateVariables,
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
        // Remove from metadata cache
        programMetadata.programRules = programMetadata.programRules.filter(rule => rule.id !== ruleId);
        programMetadata.programRuleActions = programMetadata.programRuleActions.filter(action => action.programRule.id !== ruleId);
        // Refresh display
        loadCurrentValidations();
    } catch (error) {
        console.error("Error deleting validation:", error);
        showMessage("Error deleting validation: " + error.message, "error");
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
        showMessage("Settings saved successfully");
        const modal = M.Modal.getInstance(document.getElementById("settingsModal"));
        modal.close();
    } catch (error) {
        console.error("Error saving settings:", error);
        showMessage("Error saving settings: " + error.message, "error");
    }
}

/**
 * Saves a configuration of prefix etc for a program
 * @param {string} programId - The ID of the program
 * @param {Object} config - The configuration to be saved
 */
// Services moved to ./js/services/program.js
