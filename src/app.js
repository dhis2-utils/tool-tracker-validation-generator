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
import { showVariableDetailsCtx as detailsShow, loadCurrentValidationsCtx as detailsLoadValidations, updateValidationPreviewCtx, checkFormValidityCtx, populateComparisonOptionsCtx, applyQueuedBatchTemplatesCtx } from "./js/ui/details.js";
import { removeAppSignature, parseRuleCondition } from "./js/rules/signature.js";

loadLegacyHeaderBarIfNeeded();

document.addEventListener("DOMContentLoaded", initializeApp);

let currentProgram = null;
let programMetadata = null;
let currentVariable = null;
let programConfig = null;
let dateVariables = null;
let isApplyingBatchTemplates = false;

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
    setupBatchWorkspaceListeners();
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
    renderBatchWorkspace();
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

function setupBatchWorkspaceListeners() {
    const watchedIds = [
        "batchTemplateCategory",
        "batchTemplateScope",
        "batchTemplateStage",
        "batchDateOperator",
        "batchIntervalAmount",
        "batchIntervalUnit",
        "batchDateComparisonMode",
        "batchFixedDate",
        "batchRelativeAmount",
        "batchRelativeUnit",
        "batchRelativeDirection",
        "batchNumericOperator",
        "batchNumericValue",
        "batchTemplateActionType"
    ];
    watchedIds.forEach(id => {
        const element = document.getElementById(id);
        if (!element) return;
        element.addEventListener("change", renderBatchWorkspace);
        element.addEventListener("input", renderBatchWorkspace);
    });

    document.getElementById("addBatchTemplateBtn")?.addEventListener("click", addBatchTemplate);
    document.getElementById("applyBatchTemplatesBtn")?.addEventListener("click", applyBatchTemplates);
    document.getElementById("clearBatchTemplatesBtn")?.addEventListener("click", () => {
        setState({ batchTemplates: [] });
        renderBatchWorkspace();
    });
    document.getElementById("batchTemplateDrafts")?.addEventListener("click", event => {
        const removeButton = event.target.closest("[data-remove-batch-index]");
        if (!removeButton) return;
        const index = parseInt(removeButton.dataset.removeBatchIndex, 10);
        const templates = [...(getState().batchTemplates || [])];
        templates.splice(index, 1);
        setState({ batchTemplates: templates });
        renderBatchWorkspace();
    });
}

function createBatchTemplateKey(template) {
    return [
        template.category,
        template.scope || "programme",
        template.stageId || "",
        template.operator || "",
        template.numericOperator || "",
        template.numericValue ?? "",
        template.comparisonDateMode || "",
        template.fixedComparisonDate || "",
        template.relativeComparisonAmount || "",
        template.relativeComparisonUnit || "",
        template.relativeComparisonDirection || "",
        template.actionType || "SHOWERROR"
    ].join("|");
}

function getBatchTemplateSummary(template) {
    if (template.category === "numeric") {
        const labels = {
            greater_than: "greater than",
            greater_than_or_equal: "greater than or equal to",
            less_than: "less than",
            less_than_or_equal: "less than or equal to",
            equal_to: "equal to",
            not_equal_to: "not equal to"
        };
        return `Any unvalidated numeric variable should be ${labels[template.numericOperator] || template.numericOperator} ${template.numericValue}`;
    }

    const labels = {
        before: "before",
        after: "after",
        on_or_after: "on or after",
        on_or_before: "on or before",
        within_before: "within",
        within_after: "within"
    };
    let comparisonLabel = "another date";
    if (template.comparisonDateMode === "fixed") comparisonLabel = template.fixedComparisonDate;
    if (template.comparisonDateMode === "current") comparisonLabel = "current date";
    if (template.comparisonDateMode === "relative") {
        comparisonLabel = `${template.relativeComparisonAmount} ${template.relativeComparisonUnit} ${template.relativeComparisonDirection === "past" ? "before" : "after"} current date`;
    }
    if (template.operator === "within_before" || template.operator === "within_after") {
        return `Any unvalidated date should be within ${template.intervalAmount} ${template.intervalUnit} ${template.operator === "within_before" ? "before" : "after"} ${comparisonLabel}`;
    }
    return `Any unvalidated date should be ${labels[template.operator] || template.operator} ${comparisonLabel}`;
}

function populateBatchStageOptions() {
    const stageSelect = document.getElementById("batchTemplateStage");
    if (!stageSelect || !programMetadata) return;
    const selected = stageSelect.value;
    stageSelect.innerHTML = "<option value=\"\" disabled selected>Choose stage...</option>";
    (programMetadata.programStages || []).forEach(stage => {
        const option = document.createElement("option");
        option.value = stage.id;
        option.textContent = stage.name;
        stageSelect.appendChild(option);
    });
    if (selected) {
        stageSelect.value = selected;
    }
}

function collectBatchTemplate() {
    const category = document.getElementById("batchTemplateCategory")?.value || "date";
    const scope = document.getElementById("batchTemplateScope")?.value || "programme";
    const stageId = scope === "stage" ? document.getElementById("batchTemplateStage")?.value : null;
    const actionType = document.getElementById("batchTemplateActionType")?.value || "SHOWERROR";

    if (scope === "stage" && !stageId) {
        showMessage("Choose a programme stage for this bulk rule.", "error");
        return null;
    }

    if (category === "numeric") {
        const numericOperator = document.getElementById("batchNumericOperator")?.value;
        const numericValue = document.getElementById("batchNumericValue")?.value;
        if (!numericOperator || numericValue === "") {
            showMessage("Complete the numeric bulk rule before adding it to the queue.", "error");
            return null;
        }
        return {
            category,
            scope,
            stageId,
            actionType,
            numericOperator,
            numericComparisonType: "value",
            numericValue: parseFloat(numericValue)
        };
    }

    const operator = document.getElementById("batchDateOperator")?.value;
    const comparisonDateMode = document.getElementById("batchDateComparisonMode")?.value || "fixed";
    const intervalAmount = document.getElementById("batchIntervalAmount")?.value;
    const intervalUnit = document.getElementById("batchIntervalUnit")?.value || "days";
    const fixedComparisonDate = document.getElementById("batchFixedDate")?.value;
    const relativeComparisonAmount = document.getElementById("batchRelativeAmount")?.value;
    const relativeComparisonUnit = document.getElementById("batchRelativeUnit")?.value || "years";
    const relativeComparisonDirection = document.getElementById("batchRelativeDirection")?.value || "past";

    if (!operator) {
        showMessage("Choose a date relationship before adding the bulk rule.", "error");
        return null;
    }
    if ((operator === "within_before" || operator === "within_after") && !intervalAmount) {
        showMessage("Enter an interval amount for the bulk date rule.", "error");
        return null;
    }
    if (comparisonDateMode === "fixed" && !fixedComparisonDate) {
        showMessage("Choose the fixed comparison date.", "error");
        return null;
    }
    if (comparisonDateMode === "relative" && !relativeComparisonAmount) {
        showMessage("Enter the relative offset amount.", "error");
        return null;
    }

    return {
        category,
        scope,
        stageId,
        actionType,
        operator,
        comparisonDateMode,
        comparisonDate: "",
        fixedComparisonDate: comparisonDateMode === "fixed" ? fixedComparisonDate : "",
        relativeComparisonAmount: comparisonDateMode === "relative" ? parseInt(relativeComparisonAmount, 10) : null,
        relativeComparisonUnit,
        relativeComparisonDirection,
        intervalAmount: intervalAmount ? parseInt(intervalAmount, 10) : null,
        intervalUnit
    };
}

function renderBatchWorkspace() {
    const category = document.getElementById("batchTemplateCategory")?.value || "date";
    const scope = document.getElementById("batchTemplateScope")?.value || "programme";
    const dateOperator = document.getElementById("batchDateOperator")?.value || "";
    const comparisonMode = document.getElementById("batchDateComparisonMode")?.value || "fixed";

    populateBatchStageOptions();
    document.getElementById("batchTemplateStageGroup").style.display = scope === "stage" ? "" : "none";
    document.getElementById("batchDateTemplateForm").style.display = category === "date" ? "" : "none";
    document.getElementById("batchNumericTemplateForm").style.display = category === "numeric" ? "" : "none";
    document.getElementById("batchIntervalInputs").style.display = (dateOperator === "within_before" || dateOperator === "within_after") ? "inline-flex" : "none";
    document.getElementById("batchIntervalDirection").textContent = dateOperator === "within_before" ? " before" : " after";
    document.getElementById("batchFixedDate").style.display = category === "date" && comparisonMode === "fixed" ? "" : "none";
    document.getElementById("batchRelativeInputs").style.display = category === "date" && comparisonMode === "relative" ? "inline-flex" : "none";

    const previewEl = document.getElementById("batchTemplatePreview");
    const draftTemplate = (() => {
        try {
            return collectBatchTemplateSilently();
        } catch {
            return null;
        }
    })();
    previewEl.textContent = draftTemplate ? getBatchTemplateSummary(draftTemplate) : "Configure a bulk rule template to preview it here.";

    const templates = getState().batchTemplates || [];
    const stageNameById = Object.fromEntries((programMetadata?.programStages || []).map(stage => [stage.id, stage.name]));
    const draftsContainer = document.getElementById("batchTemplateDrafts");
    draftsContainer.innerHTML = templates.length === 0
        ? "<p class='empty-state'>No queued bulk rules yet.</p>"
        : templates.map((template, index) => `
            <div class="batch-template-card">
                <div class="batch-template-header">
                    <strong>${getBatchTemplateSummary(template)}</strong>
                    <button class="btn btn-sm btn-ghost" data-remove-batch-index="${index}">Remove</button>
                </div>
                <p class="batch-template-description">These rules are applied only to variables that are currently unvalidated when you click Apply Queued Rules.</p>
                <div class="batch-template-meta">
                    <span class="variable-badge ${template.category === "numeric" ? "variable-badge-numeric" : "variable-badge-date"}">${template.category === "numeric" ? "Numeric" : "Date"}</span>
                    <span class="validation-count">${template.scope === "stage" ? `Stage: ${stageNameById[template.stageId] || "Unknown stage"}` : "Whole programme"}</span>
                    <span class="validation-count">${template.actionType}</span>
                </div>
            </div>
        `).join("");

    const applyBtn = document.getElementById("applyBatchTemplatesBtn");
    const clearBtn = document.getElementById("clearBatchTemplatesBtn");
    if (applyBtn) {
        applyBtn.disabled = templates.length === 0 || isApplyingBatchTemplates;
        applyBtn.textContent = isApplyingBatchTemplates ? "Applying queued rules..." : "Apply Queued Rules";
    }
    if (clearBtn) {
        clearBtn.disabled = templates.length === 0 || isApplyingBatchTemplates;
    }
}

function collectBatchTemplateSilently() {
    const category = document.getElementById("batchTemplateCategory")?.value || "date";
    const scope = document.getElementById("batchTemplateScope")?.value || "programme";
    const stageId = scope === "stage" ? document.getElementById("batchTemplateStage")?.value : null;
    const actionType = document.getElementById("batchTemplateActionType")?.value || "SHOWERROR";
    if (category === "numeric") {
        const numericOperator = document.getElementById("batchNumericOperator")?.value;
        const numericValue = document.getElementById("batchNumericValue")?.value;
        if (!numericOperator || numericValue === "") return null;
        return { category, scope, stageId, actionType, numericOperator, numericComparisonType: "value", numericValue: parseFloat(numericValue) };
    }
    const operator = document.getElementById("batchDateOperator")?.value;
    const comparisonDateMode = document.getElementById("batchDateComparisonMode")?.value || "fixed";
    const fixedComparisonDate = document.getElementById("batchFixedDate")?.value;
    const relativeComparisonAmount = document.getElementById("batchRelativeAmount")?.value;
    if (!operator) return null;
    if (comparisonDateMode === "fixed" && !fixedComparisonDate) return null;
    if (comparisonDateMode === "relative" && !relativeComparisonAmount) return null;
    return {
        category,
        scope,
        stageId,
        actionType,
        operator,
        comparisonDateMode,
        comparisonDate: "",
        fixedComparisonDate: comparisonDateMode === "fixed" ? fixedComparisonDate : "",
        relativeComparisonAmount: comparisonDateMode === "relative" ? parseInt(relativeComparisonAmount, 10) : null,
        relativeComparisonUnit: document.getElementById("batchRelativeUnit")?.value || "years",
        relativeComparisonDirection: document.getElementById("batchRelativeDirection")?.value || "past",
        intervalAmount: document.getElementById("batchIntervalAmount")?.value ? parseInt(document.getElementById("batchIntervalAmount").value, 10) : null,
        intervalUnit: document.getElementById("batchIntervalUnit")?.value || "days"
    };
}

function addBatchTemplate() {
    if (!programConfig?.programRuleVariablePrefix?.trim()) {
        showMessage("Configure programme settings before adding bulk rules.", "error");
        return;
    }
    const template = collectBatchTemplate();
    if (!template) return;
    const templates = [...(getState().batchTemplates || [])];
    const signature = createBatchTemplateKey(template);
    if (templates.some(existing => createBatchTemplateKey(existing) === signature)) {
        showMessage("That bulk rule is already queued.", "error");
        return;
    }
    templates.push(template);
    setState({ batchTemplates: templates });
    showMessage("Bulk rule added to the queue.");
    renderBatchWorkspace();
}

async function applyBatchTemplates() {
    const templates = getState().batchTemplates || [];
    if (templates.length === 0 || isApplyingBatchTemplates) return;
    const applyStatus = document.getElementById("batchApplyStatus");
    const applyBtn = document.getElementById("applyBatchTemplatesBtn");
    const total = templates.length;
    isApplyingBatchTemplates = true;
    if (applyBtn) {
        applyBtn.disabled = true;
        applyBtn.textContent = `Applying queued rules... 0/${total}`;
    }
    if (applyStatus) {
        applyStatus.textContent = `Applying 0 of ${total} queued rule templates...`;
    }
    renderBatchWorkspace();
    try {
        const result = await applyQueuedBatchTemplatesCtx(buildDetailsCtx(), templates, progress => {
            if (applyBtn) {
                applyBtn.textContent = `Applying queued rules... ${progress.completed}/${progress.total}`;
            }
            if (applyStatus) {
                applyStatus.textContent = `Applying ${progress.completed} of ${progress.total} queued rule templates...`;
            }
        });
        if (result.errors.length > 0) {
            showMessage(`Created ${result.createdCount} rule(s). ${result.errors.length} skipped: ${result.errors.join("; ")}`, "error");
        } else {
            showMessage(`Created ${result.createdCount} validation rule${result.createdCount !== 1 ? "s" : ""} from the queued bulk rules.`);
        }
        setState({ batchTemplates: [] });
        if (applyStatus) {
            applyStatus.textContent = "";
        }
        showOverview();
    } catch (error) {
        console.error("Error applying bulk rules:", error);
        showMessage("Error applying bulk rules: " + error.message, "error");
        if (applyStatus) {
            applyStatus.textContent = "Bulk apply failed. Review the toast for details.";
        }
    } finally {
        isApplyingBatchTemplates = false;
        if (applyBtn) {
            applyBtn.textContent = "Apply Queued Rules";
        }
        renderBatchWorkspace();
    }
}

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

        let comparisonMode = "variable";
        if (variable2.type === "fixed_date") {
            comparisonMode = "fixed";
            document.getElementById("fixedComparisonDate").value = variable2.id;
        } else if (variable2.type === "current_date") {
            comparisonMode = "current";
        } else if (variable2.type === "relative_current_date") {
            comparisonMode = "relative";
            document.getElementById("relativeComparisonAmount").value = variable2.relativeAmount || "";
            document.getElementById("relativeComparisonUnit").value = variable2.relativeUnit || "years";
            document.getElementById("relativeComparisonDirection").value = variable2.relativeDirection || "past";
        } else if (variable2.type === "enrollment") comparisonValue = "enrollment:enrollment_date";
        else if (variable2.type === "incident") comparisonValue = "incident:incident_date";
        else if (variable2.type === "event_date") comparisonValue = "event_date:event_date";
        else if (variable2.type === "dataElement") {
            comparisonValue = `dataElement:${variable2.id}${variable2.stageId ? ":" + variable2.stageId : ""}`;
        } else if (variable2.type === "trackedEntityAttribute") {
            comparisonValue = `trackedEntityAttribute:${variable2.id}`;
        }

        document.getElementById("validationOperator").value = config.operator;
        document.getElementById("comparisonDateMode").value = comparisonMode;
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
        document.getElementById("comparisonDateMode").dispatchEvent(new Event("change"));
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
