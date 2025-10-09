"use strict";

//CSS
import "materialize-css/dist/css/materialize.min.css";
import "./css/style.css";

//JS
import { d2Get, d2PostJson, d2PutJson, d2Patch, d2Delete } from "./js/d2api.js";
import { loadLegacyHeaderBarIfNeeded } from "./js/check-header-bar.js";
import M from "materialize-css";

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
    if (backButton) {
        backButton.addEventListener("click", showOverview);
    }
    
    // Note: Form-specific event listeners are now set up in setupFormEventListeners()
    // when a variable is selected, since the form elements are dynamically populated
}

function onValidationCategoryChange() {
    const selectedCategory = document.querySelector('input[name="validationCategory"]:checked')?.value;
    
    // Hide all category settings
    document.getElementById("comparisonSettings").style.display = "none";
    document.getElementById("periodSettings").style.display = "none";
    document.getElementById("actionSettings").style.display = "none";
    
    if (selectedCategory === "comparison") {
        document.getElementById("comparisonSettings").style.display = "block";
        document.getElementById("actionSettings").style.display = "block";
        populateComparisonTargets();
        updateComparisonPreview();
    } else if (selectedCategory === "period") {
        document.getElementById("periodSettings").style.display = "block";
        document.getElementById("actionSettings").style.display = "block";
        populatePeriodTargets();
        updatePeriodPreview();
    }
}

function populateComparisonTargets() {
    const select = document.getElementById("comparisonTargetDate");
    populateDateSelect(select);
}

function populatePeriodTargets() {
    const select = document.getElementById("periodTargetDate");
    populateDateSelect(select);
}

function updateComparisonPreview() {
    const comparisonType = document.getElementById("comparisonType").value;
    const targetDateId = document.getElementById("comparisonTargetDate").value;
    const preview = document.getElementById("comparisonPreview");
    
    if (!comparisonType || !targetDateId || !currentVariable) {
        preview.textContent = "Select a relationship and target date to see preview";
        return;
    }
    
    const targetDate = findDateVariable(targetDateId);
    if (!targetDate) {
        preview.textContent = "Target date not found";
        return;
    }
    
    const relationshipLabels = {
        "before_or_equal": "should be on or before",
        "before": "should be before", 
        "after_or_equal": "should be on or after",
        "after": "should be after"
    };
    
    const relationship = relationshipLabels[comparisonType];
    preview.innerHTML = `<strong>${currentVariable.name}</strong> ${relationship} <strong>${targetDate.name}</strong>`;
    
    // Auto-populate rule name and message if fields are empty
    const ruleNameField = document.getElementById("ruleName");
    const messageField = document.getElementById("validationMessage");
    
    if (!ruleNameField.value.trim()) {
        ruleNameField.placeholder = generateRuleName(currentVariable, targetDate, comparisonType);
    }
    
    if (!messageField.value.trim()) {
        messageField.placeholder = generateValidationMessage(currentVariable, targetDate, comparisonType);
    }
}

function updatePeriodPreview() {
    const periodType = document.getElementById("periodType").value;
    const periodValue = document.getElementById("periodValue").value;
    const periodUnit = document.getElementById("periodUnit").value;
    const targetDateId = document.getElementById("periodTargetDate").value;
    const preview = document.getElementById("periodPreview");
    
    if (!periodType || !periodValue || !targetDateId || !currentVariable) {
        preview.textContent = "Select all options to see preview";
        return;
    }
    
    const targetDate = findDateVariable(targetDateId);
    if (!targetDate) {
        preview.textContent = "Target date not found";
        return;
    }
    
    const typeLabels = {
        "less_than": "should be less than",
        "less_than_equal": "should be less than or equal to",
        "more_than": "should be more than",
        "more_than_equal": "should be more than or equal to"
    };
    
    const typeLabel = typeLabels[periodType];
    preview.innerHTML = `Time between <strong>${currentVariable.name}</strong> and <strong>${targetDate.name}</strong> ${typeLabel} <strong>${periodValue} ${periodUnit}</strong>`;
    
    // Auto-populate rule name and message for period validations
    const periodTypeMap = {
        "less_than": "difference_less",
        "less_than_equal": "difference_less_equal", 
        "more_than": "difference_more",
        "more_than_equal": "difference_more_equal"
    };
    
    const validationType = periodTypeMap[periodType];
    const ruleNameField = document.getElementById("ruleName");
    const messageField = document.getElementById("validationMessage");
    
    if (!ruleNameField.value.trim()) {
        ruleNameField.placeholder = generateRuleName(currentVariable, targetDate, validationType);
    }
    
    if (!messageField.value.trim()) {
        messageField.placeholder = generateValidationMessage(currentVariable, targetDate, validationType, periodValue, periodUnit);
    }
}

function showMessage(message, type = "success") {
    // Use Materialize CSS toasts instead of custom messages
    const toastClass = type === "error" ? "red" : "green";
    const iconClass = type === "error" ? "error" : "check_circle";
    
    M.toast({
        html: `<i class="material-icons left">${iconClass}</i>${message}`,
        classes: toastClass,
        displayLength: 4000
    });
}

function getCurrentlySelectedVariable() {
    // Return the currently selected variable
    return currentVariable;
}

async function loadPrograms() {
    try {
        const programs = await programsAllGet();
        populateProgramSelect(programs);
    } catch (error) {
        console.error("Error loading programs:", error);
        showMessage("Error loading programs: " + error.message, "error");
    }
}

function populateProgramSelect(programs) {
    const select = document.getElementById("programSelect");
    select.innerHTML = '<option value="" disabled selected>Select a tracker programme...</option>';
    
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
    
    // Show loading
    document.getElementById("loadingIndicator").style.display = "block";
    document.getElementById("dateVariablesOverview").style.display = "none";
    document.getElementById("dateVariableDetails").style.display = "none";
    
    try {
        // Load program config
        programConfig = await progGetConfig(programId);
        
        // Load program metadata
        programMetadata = await programGet(programId);
        
        // Build date variables array from metadata
        buildDateVariablesArray();
        
        // Show overview
        showOverview();
        
    } catch (error) {
        console.error("Error loading program:", error);
        showMessage("Error loading program: " + error.message, "error");
    } finally {
        document.getElementById("loadingIndicator").style.display = "none";
    }
}

function buildDateVariablesArray() {
    if (!programMetadata) {
        dateVariables = [];
        return;
    }
    
    dateVariables = [];
    
    // Add enrollment date
    if (programMetadata.enrollmentDateLabel) {
        dateVariables.push({
            id: "enrollment_date",
            name: programMetadata.enrollmentDateLabel,
            type: "enrollment"
        });
    }
    
    // Add incident date if displayed
    if (programMetadata.displayIncidentDate && programMetadata.incidentDateLabel) {
        dateVariables.push({
            id: "incident_date", 
            name: programMetadata.incidentDateLabel,
            type: "incident"
        });
    }
    
    // Add current date
    dateVariables.push({
        id: "current_date",
        name: "Current date",
        type: "current_date"
    });
    
    // Add data elements from program stages
    if (programMetadata.programStages) {
        programMetadata.programStages.forEach(stage => {
            // Add event date for this stage
            dateVariables.push({
                id: stage.id,
                name: `${stage.name} - ${stage.executionDateLabel || "Event date"}`,
                type: "event_date",
                stageId: stage.id
            });
            
            // Add date data elements from this stage
            if (stage.programStageDataElements) {
                stage.programStageDataElements.forEach(psde => {
                    if (psde.dataElement && psde.dataElement.valueType === "DATE") {
                        dateVariables.push({
                            id: psde.dataElement.id,
                            name: psde.dataElement.name,
                            type: "dataElement",
                            stageId: stage.id
                        });
                    }
                });
            }
        });
    }
    
    // Add tracked entity attributes
    if (programMetadata.programTrackedEntityAttributes) {
        programMetadata.programTrackedEntityAttributes.forEach(ptea => {
            if (ptea.trackedEntityAttribute && ptea.trackedEntityAttribute.valueType === "DATE") {
                dateVariables.push({
                    id: ptea.trackedEntityAttribute.id,
                    name: ptea.trackedEntityAttribute.name,
                    type: "trackedEntityAttribute"
                });
            }
        });
    }
}

function showOverview() {
    document.getElementById("dateVariablesOverview").style.display = "block";
    document.getElementById("dateVariableDetails").style.display = "none";
    
    renderDateVariables();
}

function renderDateVariables() {
    if (!programMetadata) return;
    
    // Render enrollment dates
    renderEnrollmentDates();
    
    // Render program stages
    renderProgramStages();
    
    // Update validation indicators
    updateValidationIndicators();
}

function updateValidationIndicators() {
    // Add validation indicators to date variables that have existing validations
    document.querySelectorAll(".date-variable").forEach(element => {
        const variableData = JSON.parse(element.dataset.variable);
        const validations = prGetExisting(variableData.type, variableData.id, variableData.stageId);
        
        if (validations.length > 0) {
            element.classList.add("has-validation");
        }
    });
}

function renderEnrollmentDates() {
    const container = document.getElementById("enrollmentDates");
    container.innerHTML = "";
    
    const enrollmentDates = [];
    
    // Enrollment date
    if (programMetadata.enrollmentDateLabel) {
        enrollmentDates.push({
            name: programMetadata.enrollmentDateLabel,
            type: "enrollment",
            id: "enrollment_date"
        });
    }
    
    // Incident date
    if (programMetadata.displayIncidentDate && programMetadata.incidentDateLabel) {
        enrollmentDates.push({
            name: programMetadata.incidentDateLabel,
            type: "incident",
            id: "incident_date"
        });
    }
    
    // Tracked entity attributes (dates only)
    if (programMetadata.programTrackedEntityAttributes) {
        programMetadata.programTrackedEntityAttributes.forEach(pTea => {
            if (pTea.trackedEntityAttribute.valueType === "DATE") {
                enrollmentDates.push({
                    name: pTea.trackedEntityAttribute.name,
                    type: "attribute",
                    id: pTea.trackedEntityAttribute.id
                });
            }
        });
    }
    
    enrollmentDates.forEach(dateVar => {
        const div = createDateVariableElement(dateVar);
        container.appendChild(div);
    });
}

function renderProgramStages() {
    const container = document.getElementById("programStages");
    container.innerHTML = "";
    
    if (!programMetadata.programStages) return;
    
    programMetadata.programStages.forEach(stage => {
        const stageCard = document.createElement("div");
        stageCard.className = "card";
        
        const dateElements = [];
        
        // Event date
        dateElements.push({
            name: stage.executionDateLabel || "Event date",
            type: "event_date",
            id: `event_date_${stage.id}`,
            stageId: stage.id
        });
        
        // Due date (if applicable)
        if (!stage.hideDueDate) {
            dateElements.push({
                name: "Due date",
                type: "due_date", 
                id: `due_date_${stage.id}`,
                stageId: stage.id
            });
        }
        
        // Data elements (dates only)
        if (stage.programStageDataElements) {
            stage.programStageDataElements.forEach(psde => {
                if (psde.dataElement.valueType === "DATE") {
                    dateElements.push({
                        name: psde.dataElement.name,
                        type: "data_element",
                        id: psde.dataElement.id,
                        stageId: stage.id
                    });
                }
            });
        }
        
        if (dateElements.length > 0) {
            stageCard.innerHTML = `
                <div class="card-content">
                    <span class="card-title">${stage.name}</span>
                    <div class="stage-dates">
                        ${dateElements.map(dateVar => `
                            <div class="date-variable" data-variable='${JSON.stringify(dateVar)}'>
                                <strong>${dateVar.name}</strong>
                                <span class="grey-text"> (${getVariableTypeLabel(dateVar.type)})</span>
                            </div>
                        `).join("")}
                    </div>
                </div>
            `;
            
            container.appendChild(stageCard);
        }
    });
    
    // Add click handlers for date variables
    document.querySelectorAll(".date-variable").forEach(element => {
        element.addEventListener("click", () => {
            const variableData = JSON.parse(element.dataset.variable);
            showVariableDetails(variableData);
        });
    });
}

function createDateVariableElement(dateVar) {
    const div = document.createElement("div");
    div.className = "date-variable";
    div.dataset.variable = JSON.stringify(dateVar);
    
    div.innerHTML = `
        <strong>${dateVar.name}</strong>
        <span class="grey-text"> (${getVariableTypeLabel(dateVar.type)})</span>
    `;
    
    div.addEventListener("click", () => {
        showVariableDetails(dateVar);
    });
    
    return div;
}

function getVariableTypeLabel(type) {
    const labels = {
        "enrollment": "Enrollment Date",
        "incident": "Incident Date", 
        "attribute": "Tracked Entity Attribute",
        "event_date": "Event Date",
        "due_date": "Due Date",
        "data_element": "Data Element"
    };
    return labels[type] || type;
}

function showVariableDetails(variable) {
    currentVariable = variable;
    
    document.getElementById("dateVariablesOverview").style.display = "none";
    document.getElementById("dateVariableDetails").style.display = "block";
    
    document.getElementById("variableDetailsTitle").textContent = `${variable.name} - Validation Settings`;
    
    // Set the validated date name in the sentence
    document.getElementById("validatedDateName").textContent = variable.name;
    
    // Load current validations
    loadCurrentValidations();
    
    // Reset and setup validation form
    setupValidationForm();
}

function setupValidationForm() {
    // Clear any existing form state
    document.getElementById("validationOperator").value = "";
    document.getElementById("comparisonDate").value = "";
    document.getElementById("intervalInputs").style.display = "none";
    document.getElementById("intervalAmount").value = "";
    document.getElementById("intervalUnit").value = "days";
    document.getElementById("createValidationBtn").disabled = true;
    document.getElementById("ruleName").value = "";
    document.getElementById("ruleDescription").value = "";
    document.getElementById("ruleMessage").value = "";
    
    // Populate comparison date options
    populateComparisonDates();
    
    // Setup event listeners BEFORE initializing Materialize
    setupFormEventListeners();
    
    // Destroy any existing Materialize select instances to prevent duplication
    const allSelects = document.querySelectorAll('#dateVariableDetails select');
    allSelects.forEach(select => {
        const instance = M.FormSelect.getInstance(select);
        if (instance) {
            instance.destroy();
        }
    });
    
    // Initialize Materialize selects AFTER setting up listeners and destroying old instances
    M.FormSelect.init(allSelects);
    
    console.log("Validation form setup complete"); // Debug log
}

function setupFormEventListeners() {
    // Remove any existing listeners to avoid duplicates
    const operatorSelect = document.getElementById("validationOperator");
    
    console.log("Setting up form event listeners"); // Debug log
    console.log("Operator select element:", operatorSelect); // Debug log
    
    // Clone and replace to remove any existing listeners
    const newOperatorSelect = operatorSelect.cloneNode(true);
    operatorSelect.parentNode.replaceChild(newOperatorSelect, operatorSelect);
    
    // Validation operator change - use both 'change' and Materialize-specific events
    const handleOperatorChange = function() {
        const value = this.value;
        const intervalInputs = document.getElementById("intervalInputs");
        const intervalDirection = document.getElementById("intervalDirection");
        
        console.log("Operator changed to:", value); // Debug log
        console.log("Interval inputs element:", intervalInputs); // Debug log
        
        if (value === "within_before" || value === "within_after") {
            intervalInputs.style.display = "inline-flex";
            intervalDirection.textContent = value === "within_before" ? " before" : " after";
            console.log("Showing interval inputs"); // Debug log
        } else {
            intervalInputs.style.display = "none";
            console.log("Hiding interval inputs"); // Debug log
        }
        
        updateValidationPreview();
        checkFormValidity();
    };
    
    document.getElementById("validationOperator").addEventListener("change", handleOperatorChange);
    
    // Also listen for Materialize's FormSelect change event
    document.getElementById("validationOperator").addEventListener("click", function() {
        // Delay to let Materialize update the value
        setTimeout(handleOperatorChange.bind(this), 100);
    });
    
    // Other form elements
    ["comparisonDate", "intervalAmount", "intervalUnit", "ruleName", "ruleMessage"].forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.addEventListener("change", () => {
                updateValidationPreview();
                checkFormValidity();
            });
            element.addEventListener("input", () => {
                updateValidationPreview();
                checkFormValidity();
            });
        }
    });
    
    // Create button
    const createBtn = document.getElementById("createValidationBtn");
    if (createBtn) {
        createBtn.addEventListener("click", createValidationRule);
    }
}

function updateValidationPreview() {
    const operator = document.getElementById("validationOperator").value;
    const comparisonDate = document.getElementById("comparisonDate").value;
    const intervalAmount = document.getElementById("intervalAmount").value;
    const intervalUnit = document.getElementById("intervalUnit").value;
    
    let preview = "";
    let suggestedRuleName = "";
    let suggestedMessage = "";
    
    if (operator && comparisonDate) {
        const variableName = currentVariable.name;
        const comparisonOption = document.querySelector(`#comparisonDate option[value="${comparisonDate}"]`);
        const comparisonName = comparisonOption ? comparisonOption.textContent : "";
        
        switch (operator) {
            case "before":
                preview = `${variableName} should be before ${comparisonName}`;
                suggestedRuleName = `${variableName} must be before ${comparisonName}`;
                suggestedMessage = `${variableName} must be before ${comparisonName}`;
                break;
            case "after":
                preview = `${variableName} should be after ${comparisonName}`;
                suggestedRuleName = `${variableName} must be after ${comparisonName}`;
                suggestedMessage = `${variableName} must be after ${comparisonName}`;
                break;
            case "on_or_after":
                preview = `${variableName} should be on or after ${comparisonName}`;
                suggestedRuleName = `${variableName} must be on or after ${comparisonName}`;
                suggestedMessage = `${variableName} must be on or after ${comparisonName}`;
                break;
            case "on_or_before":
                preview = `${variableName} should be on or before ${comparisonName}`;
                suggestedRuleName = `${variableName} must be on or before ${comparisonName}`;
                suggestedMessage = `${variableName} must be on or before ${comparisonName}`;
                break;
            case "within_before":
                if (intervalAmount && intervalUnit) {
                    preview = `${variableName} should be within ${intervalAmount} ${intervalUnit} before ${comparisonName}`;
                    suggestedRuleName = `${variableName} within ${intervalAmount} ${intervalUnit} before ${comparisonName}`;
                    suggestedMessage = `${variableName} must be within ${intervalAmount} ${intervalUnit} before ${comparisonName}`;
                }
                break;
            case "within_after":
                if (intervalAmount && intervalUnit) {
                    preview = `${variableName} should be within ${intervalAmount} ${intervalUnit} after ${comparisonName}`;
                    suggestedRuleName = `${variableName} within ${intervalAmount} ${intervalUnit} after ${comparisonName}`;
                    suggestedMessage = `${variableName} must be within ${intervalAmount} ${intervalUnit} after ${comparisonName}`;
                }
                break;
        }
    }
    
    document.getElementById("validationPreview").textContent = preview || "Configure the validation above to see preview";
    
    // Auto-fill rule name and message if they're empty
    const ruleNameInput = document.getElementById("ruleName");
    const ruleMessageInput = document.getElementById("ruleMessage");
    
    if (suggestedRuleName && !ruleNameInput.value) {
        ruleNameInput.value = suggestedRuleName;
        // Trigger Materialize label update
        M.updateTextFields();
    }
    
    if (suggestedMessage && !ruleMessageInput.value) {
        ruleMessageInput.value = suggestedMessage;
        // Trigger Materialize label update
        M.updateTextFields();
    }
}

function checkFormValidity() {
    const operator = document.getElementById("validationOperator").value;
    const comparisonDate = document.getElementById("comparisonDate").value;
    const intervalAmount = document.getElementById("intervalAmount").value;
    const ruleName = document.getElementById("ruleName").value;
    const ruleMessage = document.getElementById("ruleMessage").value;
    
    let isValid = operator && comparisonDate && ruleName && ruleMessage;
    
    // Check interval fields if needed
    if ((operator === "within_before" || operator === "within_after") && !intervalAmount) {
        isValid = false;
    }
    
    document.getElementById("createValidationBtn").disabled = !isValid;
}

function createValidationRule() {
    if (document.getElementById("createValidationBtn").disabled) return;
    
    const operator = document.getElementById("validationOperator").value;
    const comparisonDate = document.getElementById("comparisonDate").value;
    const intervalAmount = document.getElementById("intervalAmount").value;
    const intervalUnit = document.getElementById("intervalUnit").value;
    const ruleName = document.getElementById("ruleName").value;
    const ruleDescription = document.getElementById("ruleDescription").value;
    const ruleMessage = document.getElementById("ruleMessage").value;
    
    // Create the validation based on the new interface
    const validationConfig = {
        operator,
        comparisonDate,
        intervalAmount: intervalAmount ? parseInt(intervalAmount) : null,
        intervalUnit,
        ruleName,
        ruleDescription,
        ruleMessage
    };
    
    addValidation(validationConfig);
}

function loadCurrentValidations() {
    if (!currentVariable) return;
    
    const validations = prGetExisting(currentVariable.type, currentVariable.id, currentVariable.stageId);
    const container = document.getElementById("currentValidations");
    
    if (validations.length === 0) {
        container.innerHTML = "<p class='grey-text'>No validations configured for this date variable.</p>";
        return;
    }
    
    container.innerHTML = validations.map(validation => {
        const action = validation.actions.find(a => 
            ["SHOWWARNING", "SHOWERROR", "WARNINGONCOMPLETE", "ERRORONCOMPLETE"].includes(a.programRuleActionType)
        );
        
        const actionType = action ? action.programRuleActionType : "UNKNOWN";
        const actionClass = actionType.includes("ERROR") ? "error" : "warning";
        
        return `
            <div class="validation-rule ${actionClass}">
                <h6>${validation.rule.name}</h6>
                <p><strong>Rule ID:</strong> <code>${validation.rule.id}</code></p>
                <p><strong>Condition:</strong> ${validation.rule.condition}</p>
                <p><strong>Action:</strong> ${actionType}</p>
                ${action.content ? `<p><strong>Message:</strong> ${action.content}</p>` : ""}
                <div class="validation-actions">
                    <button class="btn-small red" onclick="deleteValidation('${validation.rule.id}')">
                        <i class="material-icons left">delete</i>Delete
                    </button>
                </div>
            </div>
        `;
    }).join("");
}

function findDateVariable(variableId) {
    if (!programMetadata) return null;
    
    // Check current date
    if (variableId === "current_date") {
        return {
            name: "Current date",
            type: "current_date",
            id: "current_date",
            prvName: "current_date"
        };
    }
    
    // Check enrollment dates
    if (variableId === "enrollment_date") {
        return {
            name: programMetadata.enrollmentDateLabel,
            type: "enrollment",
            id: "enrollment_date",
            prvName: "enrollment_date"
        };
    }
    
    if (variableId === "incident_date") {
        return {
            name: programMetadata.incidentDateLabel,
            type: "incident",
            id: "incident_date", 
            prvName: "incident_date"
        };
    }
    
    // Check tracked entity attributes
    if (programMetadata.programTrackedEntityAttributes) {
        for (const ptea of programMetadata.programTrackedEntityAttributes) {
            if (ptea.trackedEntityAttribute.id === variableId && ptea.trackedEntityAttribute.valueType === "DATE") {
                const prv = prvGetSet("trackedEntityAttribute", ptea.trackedEntityAttribute.id);
                return {
                    name: ptea.trackedEntityAttribute.name,
                    type: "attribute",
                    id: ptea.trackedEntityAttribute.id,
                    prvName: prv ? prv.name : null
                };
            }
        }
    }
    
    // Check program stages
    if (programMetadata.programStages) {
        for (const stage of programMetadata.programStages) {
            // Event dates
            if (variableId === `event_date_${stage.id}`) {
                return {
                    name: stage.executionDateLabel || "Event date",
                    type: "event_date",
                    id: `event_date_${stage.id}`,
                    stageId: stage.id,
                    prvName: `event_date_${stage.id}`
                };
            }
            
            // Data elements
            if (stage.programStageDataElements) {
                for (const psde of stage.programStageDataElements) {
                    if (psde.dataElement.id === variableId && psde.dataElement.valueType === "DATE") {
                        const prv = prvGetSet("dataElement", psde.dataElement.id);
                        return {
                            name: psde.dataElement.name,
                            type: "data_element",
                            id: psde.dataElement.id,
                            stageId: stage.id,
                            prvName: prv ? prv.name : null
                        };
                    }
                }
            }
        }
    }
    
    return null;
}

function populateDateSelect(selectElement) {
    selectElement.innerHTML = '<option value="" disabled selected>Choose date to compare with</option>';
    
    if (!programMetadata) return;
    
    const allDates = [];
    
    // Add current date as an option
    allDates.push({
        name: "Current date",
        type: "current_date",
        id: "current_date",
        prvName: "current_date"
    });
    
    // Enrollment dates
    if (programMetadata.enrollmentDateLabel) {
        allDates.push({
            name: programMetadata.enrollmentDateLabel,
            type: "enrollment",
            id: "enrollment_date",
            prvName: "enrollment_date"
        });
    }
    
    if (programMetadata.displayIncidentDate && programMetadata.incidentDateLabel) {
        allDates.push({
            name: programMetadata.incidentDateLabel,
            type: "incident", 
            id: "incident_date",
            prvName: "incident_date"
        });
    }
    
    // Tracked entity attributes
    if (programMetadata.programTrackedEntityAttributes) {
        programMetadata.programTrackedEntityAttributes.forEach(ptea => {
            if (ptea.trackedEntityAttribute.valueType === "DATE") {
                const prv = prvGetSet("trackedEntityAttribute", ptea.trackedEntityAttribute.id);
                allDates.push({
                    name: ptea.trackedEntityAttribute.name,
                    type: "attribute",
                    id: ptea.trackedEntityAttribute.id,
                    prvName: prv ? prv.name : null
                });
            }
        });
    }
    
    // Program stages
    if (programMetadata.programStages) {
        programMetadata.programStages.forEach(stage => {
            // Event dates
            allDates.push({
                name: stage.executionDateLabel || "Event date",
                type: "event_date",
                id: `event_date_${stage.id}`,
                stageId: stage.id,
                prvName: `event_date_${stage.id}`
            });
            
            // Data elements
            if (stage.programStageDataElements) {
                stage.programStageDataElements.forEach(psde => {
                    if (psde.dataElement.valueType === "DATE") {
                        const prv = prvGetSet("dataElement", psde.dataElement.id);
                        allDates.push({
                            name: psde.dataElement.name,
                            type: "data_element",
                            id: psde.dataElement.id,
                            stageId: stage.id,
                            prvName: prv ? prv.name : null
                        });
                    }
                });
            }
        });
    }
    
    // Filter out the current variable and apply stage restrictions
    const filteredDates = allDates.filter(date => {
        // Don't compare a variable with itself
        if (currentVariable.type === "attribute" && date.type === "attribute") {
            return date.id !== currentVariable.id;
        }
        if (currentVariable.type === "data_element" && date.type === "data_element") {
            return date.id !== currentVariable.id;
        }
        if (currentVariable.type === "event_date" && date.type === "event_date") {
            return date.id !== currentVariable.id;
        }
        
        // Stage restriction: data elements can only be compared with dates from the same stage
        if (currentVariable.type === "data_element" && date.type === "data_element") {
            return date.stageId === currentVariable.stageId;
        }
        
        // Data elements can also be compared with event dates from the same stage
        if (currentVariable.type === "data_element" && date.type === "event_date") {
            return date.stageId === currentVariable.stageId;
        }
        
        // Event dates can be compared with data elements from the same stage
        if (currentVariable.type === "event_date" && date.type === "data_element") {
            return date.stageId === currentVariable.stageId;
        }
        
        return true;
    });
    
    filteredDates.forEach(date => {
        const option = document.createElement("option");
        option.value = date.id;
        option.textContent = date.name;
        selectElement.appendChild(option);
    });
}

function resetValidationForm() {
    // Clear all form selections
    document.querySelectorAll('input[name="validationCategory"]').forEach(radio => radio.checked = false);
    document.getElementById("comparisonType").value = "";
    document.getElementById("comparisonTargetDate").value = "";
    document.getElementById("periodType").value = "";
    document.getElementById("periodValue").value = "";
    document.getElementById("periodTargetDate").value = "";
    document.getElementById("ruleName").value = "";
    document.getElementById("ruleDescription").value = "";
    document.getElementById("validationMessage").value = "";
    
    // Hide all category settings
    document.getElementById("comparisonSettings").style.display = "none";
    document.getElementById("periodSettings").style.display = "none";
    document.getElementById("actionSettings").style.display = "none";
    
    // Reset previews
    document.getElementById("comparisonPreview").textContent = "Select a relationship and target date to see preview";
    document.getElementById("periodPreview").textContent = "Select all options to see preview";
}

function populateComparisonDates() {
    const select = document.getElementById("comparisonDate");
    if (!select) return;
    
    // Destroy existing Materialize select instance to avoid duplication
    const instance = M.FormSelect.getInstance(select);
    if (instance) {
        instance.destroy();
    }
    
    // Clear existing options
    select.innerHTML = '<option value="" disabled selected>Choose date...</option>';
    
    if (!currentVariable || !dateVariables) return;
    
    // Add date options with proper filtering based on DHIS2 validation rules
    dateVariables.forEach(variable => {
        // Don't compare a variable with itself
        if (variable.id === currentVariable.id && variable.type === currentVariable.type && 
            variable.stageId === currentVariable.stageId) {
            return;
        }
        
        let shouldInclude = false;
        
        // All dates can be compared to current date
        if (variable.type === "current_date") {
            shouldInclude = true;
        }
        // Apply filtering rules based on what's being validated
        else if (currentVariable.type === "enrollment") {
            // Enrollment date can only be compared with: incident date, tracked entity attributes
            shouldInclude = variable.type === "incident" || 
                          variable.type === "trackedEntityAttribute";
        } 
        else if (currentVariable.type === "incident") {
            // Incident date can only be compared with: enrollment date, tracked entity attributes
            shouldInclude = variable.type === "enrollment" || 
                          variable.type === "trackedEntityAttribute";
        }
        else if (currentVariable.type === "trackedEntityAttribute") {
            // Tracked entity attributes can only be compared with: enrollment date, incident date
            shouldInclude = variable.type === "enrollment" || 
                          variable.type === "incident";
        }
        else if (currentVariable.type === "event_date") {
            // Event/due dates cannot be compared to other event dates or data elements in other stages
            // They can only be compared with: enrollment, incident, tracked entity attributes, data elements from same stage
            if (variable.type === "enrollment" || variable.type === "incident" || variable.type === "trackedEntityAttribute") {
                shouldInclude = true;
            } else if (variable.type === "dataElement") {
                // Only data elements from the same stage
                shouldInclude = variable.stageId === currentVariable.stageId;
            }
            // Cannot be compared with other event dates
        }
        else if (currentVariable.type === "dataElement") {
            // Data elements cannot be compared to event/due dates or data element dates from other stages
            // They can only be compared with: enrollment, incident, tracked entity attributes, data elements from same stage
            if (variable.type === "enrollment" || variable.type === "incident" || variable.type === "trackedEntityAttribute") {
                shouldInclude = true;
            } else if (variable.type === "dataElement") {
                // Only data elements from the same stage
                shouldInclude = variable.stageId === currentVariable.stageId;
            }
            // Cannot be compared with event/due dates
        }
        else if (currentVariable.type === "current_date") {
            // Current date can be compared with anything
            shouldInclude = true;
        }
        
        if (shouldInclude) {
            const option = document.createElement("option");
            option.value = `${variable.type}:${variable.id}${variable.stageId ? ':' + variable.stageId : ''}`;
            option.textContent = variable.name;
            select.appendChild(option);
        }
    });
    
    // Note: Materialize select initialization is handled in setupValidationForm()
}

async function addValidation(config) {
    if (!config || !currentVariable) {
        showMessage("Invalid configuration", "error");
        return;
    }
    
    try {
        // Parse comparison date
        const [compareType, compareId, compareStageId] = config.comparisonDate.split(':');
        const compareDate = findDateVariableByComponents(compareId, compareType, compareStageId);
        
        if (!compareDate) {
            showMessage("Target date not found", "error");
            return;
        }
        
        // Check for name conflicts
        const existingRule = programMetadata.programRules.find(rule => rule.name === config.ruleName);
        if (existingRule) {
            showMessage(`A program rule with the name "${config.ruleName}" already exists. Please choose a different name.`, "error");
            return;
        }
        
        // Get or create PRVs for both variables (if needed)
        const variable1Prv = await ensureProgramRuleVariable(currentVariable);
        const variable2Prv = await ensureProgramRuleVariable(compareDate);
        
        // Generate rule condition based on operator
        const ruleCondition = generateNewRuleCondition(
            { ...currentVariable, prvName: variable1Prv.name },
            { ...compareDate, prvName: variable2Prv.name },
            config
        );
        
        // Create program rule
        const programRule = {
            name: config.ruleName,
            description: config.ruleDescription || `Date validation rule for ${currentVariable.name}`,
            condition: ruleCondition,
            program: { id: currentProgram },
            priority: 1
        };
        
        // Add stage restriction if validating a data element
        if (currentVariable.type === "dataElement" && currentVariable.stageId) {
            programRule.programStage = { id: currentVariable.stageId };
        }
        
        // Create program rule action
        const programRuleAction = {
            programRuleActionType: "SHOWERROR",
            content: config.ruleMessage,
            program: { id: currentProgram }
        };
        
        // Link action to the appropriate field
        if (currentVariable.type === "dataElement") {
            programRuleAction.dataElement = { id: currentVariable.id };
        } else if (currentVariable.type === "trackedEntityAttribute") {
            programRuleAction.trackedEntityAttribute = { id: currentVariable.id };
        }
        
        // Create the rule
        await prCreate(programRule, [programRuleAction], []);
        
        showMessage("Validation rule created successfully");
        
        // Refresh the current validations display
        loadCurrentValidations();
        
        // Since loadCurrentValidations already uses currentVariable, no need for additional call
        
        // Clear the form
        setupValidationForm();
        
    } catch (error) {
        console.error("Error creating validation rule:", error);
        showMessage("Error creating validation rule: " + (error.message || error), "error");
    }
}

function generateNewRuleCondition(variable1, variable2, config) {
    const var1Ref = getVariableReference(variable1);
    const var2Ref = getVariableReference(variable2);
    
    switch (config.operator) {
        case "before":
            return `${var1Ref} >= ${var2Ref}`;
        case "after":
            return `${var1Ref} <= ${var2Ref}`;
        case "on_or_after":
            return `${var1Ref} < ${var2Ref}`;
        case "on_or_before":
            return `${var1Ref} > ${var2Ref}`;
        case "within_before":
            return generateIntervalCondition(var2Ref, var1Ref, config.intervalAmount, config.intervalUnit);
        case "within_after":
            return generateIntervalCondition(var1Ref, var2Ref, config.intervalAmount, config.intervalUnit);
        default:
            throw new Error(`Unknown operator: ${config.operator}`);
    }
}

function generateIntervalCondition(startDateRef, endDateRef, amount, unit) {
    // Generate condition that checks if the interval between dates exceeds the specified amount
    // Returns true when validation should FAIL (i.e., when the interval is too large)
    
    let dhisFunction;
    switch (unit) {
        case "days":
            dhisFunction = "d2:daysBetween";
            break;
        case "weeks":
            dhisFunction = "d2:weeksBetween";
            break;
        case "months":
            dhisFunction = "d2:monthsBetween";
            break;
        case "years":
            dhisFunction = "d2:yearsBetween";
            break;
        default:
            throw new Error(`Unknown time unit: ${unit}`);
    }
    
    return `${dhisFunction}(${startDateRef}, ${endDateRef}) > ${amount}`;
}

function findDateVariableByComponents(id, type, stageId) {
    if (!dateVariables) return null;
    
    return dateVariables.find(variable => {
        if (variable.id === id && variable.type === type) {
            // If stageId is specified, match it; otherwise, match variables without stageId
            if (stageId) {
                return variable.stageId === stageId;
            } else {
                return !variable.stageId || variable.type !== "dataElement";
            }
        }
        return false;
    });
}

async function ensureProgramRuleVariable(variable) {
    // For built-in variables (enrollment, incident, event, due dates, current date), we don't need PRVs
    if (["enrollment", "incident", "event_date", "due_date", "current_date"].includes(variable.type)) {
        return { name: variable.prvName || variable.type };
    }
    
    // For data elements and tracked entity attributes, get or create PRV
    const type = variable.type === "data_element" ? "dataElement" : "trackedEntityAttribute";
    let prv = prvGetSet(type, variable.id);
    
    if (!prv.id) {
        // Need to create the PRV
        prv.id = await getId();
        const created = await d2PostJson("programRuleVariables", prv);
        
        // Add to our metadata cache
        programMetadata.programRuleVariables.push(created);
        
        return created;
    }
    
    return prv;
}

function generateValidationMessage(variable1, variable2, validationType, differenceValue, differenceUnit) {
    const typeMessages = {
        "before_or_equal": `${variable1.name} should be on or before ${variable2.name}`,
        "before": `${variable1.name} should be before ${variable2.name}`,
        "after_or_equal": `${variable1.name} should be on or after ${variable2.name}`,
        "after": `${variable1.name} should be after ${variable2.name}`,
        "difference_less": `Difference between ${variable1.name} and ${variable2.name} should be less than ${differenceValue} ${differenceUnit}`,
        "difference_less_equal": `Difference between ${variable1.name} and ${variable2.name} should be less than or equal to ${differenceValue} ${differenceUnit}`,
        "difference_more": `Difference between ${variable1.name} and ${variable2.name} should be more than ${differenceValue} ${differenceUnit}`,
        "difference_more_equal": `Difference between ${variable1.name} and ${variable2.name} should be more than or equal to ${differenceValue} ${differenceUnit}`
    };
    
    return typeMessages[validationType] || "Date validation error";
}

// Global function for delete validation (called from HTML)
window.deleteValidation = async function(ruleId) {
    if (!confirm("Are you sure you want to delete this validation rule?")) {
        return;
    }
    
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
    }
    
    modal.open();
}

async function saveSettings() {
    const prefix = document.getElementById("programRulePrefix").value;
    const variablePrefix = document.getElementById("programRuleVariablePrefix").value;
    
    const config = {
        programRulePrefix: prefix,
        programRuleVariablePrefix: variablePrefix
    };
    
    try {
        await progSetConfig(currentProgram, config);
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
 * Gets the PRV for a data element or tracked entity attribute with the given ID from the API; creates a programRuleVariable object if it doesn't exist (but doesn't POST it to the API)
 * @param {string} type - The type of the element (data element or tracked entity attribute)
 * @param {string} id - The ID of the element
 * @returns {Object} The program rule variable object
 */
function prvGetSet(type, id) {
    if (!programMetadata) return null;
    
    // Look for existing PRV
    const existingPrv = programMetadata.programRuleVariables.find(prv => {
        if (type === "dataElement" && prv.dataElement && prv.dataElement.id === id) {
            return true;
        }
        if (type === "trackedEntityAttribute" && prv.trackedEntityAttribute && prv.trackedEntityAttribute.id === id) {
            return true;
        }
        return false;
    });
    
    if (existingPrv) {
        return existingPrv;
    }
    
    // Create new PRV object (not posted to API yet)
    const prefix = programConfig?.programRuleVariablePrefix || "";
    let sourceName = "";
    
    if (type === "dataElement") {
        const dataElement = findDataElementById(id);
        sourceName = dataElement ? sanitizeName(dataElement.name) : id;
    } else if (type === "trackedEntityAttribute") {
        const attribute = findAttributeById(id);
        sourceName = attribute ? sanitizeName(attribute.name) : id;
    }
    
    return {
        id: null, // Will be set when posted
        name: `${prefix}${sourceName}`,
        program: { id: currentProgram },
        programRuleVariableSourceType: type === "dataElement" ? "DATAELEMENT_CURRENT_EVENT" : "TEI_ATTRIBUTE",
        dataElement: type === "dataElement" ? { id } : undefined,
        trackedEntityAttribute: type === "trackedEntityAttribute" ? { id } : undefined,
        valueType: "DATE"
    };
}

/**
 * Creates a new programRule and associated programRuleVariables and programRuleActions using POST operation
 * @param {Object} programRule - The program rule to create
 * @param {Array} programRuleActions - The program rule actions to create  
 * @param {Array} programRuleVariables - The program rule variables to create
 */
async function prCreate(programRule, programRuleActions, programRuleVariables) {
    try {
        // First create any new program rule variables
        const createdVariables = [];
        for (const prv of programRuleVariables) {
            if (!prv.id) { // New variable
                prv.id = await getId();
                const created = await d2PostJson("programRuleVariables", prv);
                createdVariables.push(created);
                // Add to local cache
                programMetadata.programRuleVariables.push(created);
            }
        }
        
        // Create program rule
        programRule.id = await getId();
        const createdRule = await d2PostJson("programRules", programRule);
        // Add to local cache
        programMetadata.programRules.push(createdRule);
        
        // Create program rule actions
        const createdActions = [];
        for (const pra of programRuleActions) {
            pra.id = await getId();
            pra.programRule = { id: programRule.id };
            const created = await d2PostJson("programRuleActions", pra);
            createdActions.push(created);
            // Add to local cache
            programMetadata.programRuleActions.push(created);
        }
        
        return {
            programRule: createdRule,
            programRuleActions: createdActions,
            programRuleVariables: createdVariables
        };
    } catch (error) {
        console.error("Error creating program rule:", error);
        throw error;
    }
}

/**
 * Identifies all the validations currently existing for a particular variable
 * @param {string} type - The type of the variable
 * @param {string} id - The ID of the variable
 * @returns {Array} An array of validations
 */
function prGetExisting(type, id, stageId = null) {
    if (!programMetadata) return [];
    
    const validations = [];
    
    // Find program rule variables that reference this variable (for data elements and tracked entity attributes)
    const relatedPrvs = programMetadata.programRuleVariables.filter(prv => {
        if ((type === "dataElement" || type === "data_element") && prv.dataElement && prv.dataElement.id === id) return true;
        if ((type === "trackedEntityAttribute" || type === "attribute") && prv.trackedEntityAttribute && prv.trackedEntityAttribute.id === id) return true;
        return false;
    });
    
    // Find program rules that use these variables and have validation actions
    programMetadata.programRules.forEach(rule => {
        const validationActions = programMetadata.programRuleActions.filter(action => 
            action.programRule && action.programRule.id === rule.id && 
            ["SHOWWARNING", "SHOWERROR", "WARNINGONCOMPLETE", "ERRORONCOMPLETE"].includes(action.programRuleActionType)
        );
        
        if (validationActions.length > 0 && rule.condition) {
            let usesVariable = false;
            
            // For system dates, we need to check if the validation is ABOUT that date
            // This means either the rule is scoped to that context OR the action is linked to it
            if (type === "enrollment") {
                // For enrollment date, the rule should either:
                // 1. Have no specific stage/element target (general rule), OR
                // 2. Have an action specifically linked to enrollment context
                usesVariable = rule.condition.includes("V{enrollment_date}") && (
                    !rule.programStage || // General rule not limited to a stage
                    validationActions.some(action => !action.dataElement && !action.trackedEntityAttribute) // Action not targeting specific element
                );
            } else if (type === "incident") {
                usesVariable = rule.condition.includes("V{incident_date}") && (
                    !rule.programStage ||
                    validationActions.some(action => !action.dataElement && !action.trackedEntityAttribute)
                );
            } else if (type === "event_date") {
                // For event dates, must directly use V{event_date} AND be linked to the correct stage
                // AND not be validating a specific data element within that stage
                usesVariable = rule.condition.includes("V{event_date}") && 
                             (!stageId || !rule.programStage || rule.programStage.id === stageId) &&
                             validationActions.some(action => !action.dataElement && !action.trackedEntityAttribute);
            } else if (type === "current_date") {
                // Current date is a bit special - it's often used in comparisons
                // Only include if it's the main focus of validation
                usesVariable = rule.condition.includes("V{current_date}") &&
                             validationActions.some(action => !action.dataElement && !action.trackedEntityAttribute);
            } else {
                // For data elements and tracked entity attributes
                // Check if any of the related PRVs are used in the condition
                usesVariable = relatedPrvs.some(prv => 
                    rule.condition.includes(`#{${prv.name}}`) || rule.condition.includes(`A{${prv.name}}`)
                );
                
                // For data elements, also check stage restriction
                if (usesVariable && (type === "dataElement" || type === "data_element") && stageId) {
                    usesVariable = !rule.programStage || rule.programStage.id === stageId;
                }
                
                // ADDITIONAL CHECK: Look for actions directly linked to this data element/attribute
                if (!usesVariable && (type === "dataElement" || type === "data_element" || type === "trackedEntityAttribute" || type === "attribute")) {
                    const hasLinkedAction = validationActions.some(action => 
                        (((type === "dataElement" || type === "data_element") && action.dataElement && action.dataElement.id === id) ||
                         ((type === "trackedEntityAttribute" || type === "attribute") && action.trackedEntityAttribute && action.trackedEntityAttribute.id === id))
                    );
                    usesVariable = hasLinkedAction;
                }
            }
            
            if (usesVariable) {
                validations.push({
                    rule,
                    actions: validationActions
                });
            }
        }
    });
    
    return validations;
}

function getValidationStageId(variable1, variable2) {
    // If either variable is stage-specific, use that stage
    // Priority: data_element > event_date > no restriction
    
    // Check variable1
    if (variable1.type === "data_element" && variable1.stageId) {
        return variable1.stageId;
    }
    if (variable1.type === "event_date" && variable1.stageId) {
        return variable1.stageId;
    }
    
    // Check variable2
    if (variable2.type === "data_element" && variable2.stageId) {
        return variable2.stageId;
    }
    if (variable2.type === "event_date" && variable2.stageId) {
        return variable2.stageId;
    }
    
    // No stage restriction needed for enrollment/incident dates, tracked entity attributes, or current date
    return null;
}

// Helper functions
function findDataElementById(id) {
    if (!programMetadata.programStages) return null;
    
    for (const stage of programMetadata.programStages) {
        if (stage.programStageDataElements) {
            const found = stage.programStageDataElements.find(psde => psde.dataElement.id === id);
            if (found) return found.dataElement;
        }
    }
    return null;
}

function findAttributeById(id) {
    if (!programMetadata.programTrackedEntityAttributes) return null;
    
    const found = programMetadata.programTrackedEntityAttributes.find(ptea => ptea.trackedEntityAttribute.id === id);
    return found ? found.trackedEntityAttribute : null;
}

function sanitizeName(name) {
    return name.replace(/[^a-zA-Z0-9_]/g, "_").toUpperCase();
}

function generateRuleName(variable1, variable2, validationType) {
    const prefix = programConfig?.programRulePrefix || "";
    const typeLabels = {
        "before_or_equal": "should be on or before",
        "before": "should be before", 
        "after_or_equal": "should be on or after",
        "after": "should be after",
        "difference_less": "difference should be less than",
        "difference_less_equal": "difference should be less than or equal to",
        "difference_more": "difference should be more than", 
        "difference_more_equal": "difference should be more than or equal to"
    };
    
    return `${prefix}Date validation: ${variable1.name} ${typeLabels[validationType]} ${variable2.name}`;
}

function generateRuleCondition(variable1, variable2, validationType, differenceValue, differenceUnit) {
    const var1Ref = getVariableReference(variable1);
    const var2Ref = getVariableReference(variable2);
    
    // Build positive condition: when should the validation trigger (when the rule is violated)
    let hasValueCondition = `d2:hasValue(${var1Ref})`;
    if (!isSystemVariable(variable2)) {
        hasValueCondition += ` && d2:hasValue(${var2Ref})`;
    }
    
    let violationCondition;
    switch (validationType) {
        case "before_or_equal":
            violationCondition = `d2:daysBetween(${var1Ref}, ${var2Ref}) > 0`;
            break;
        case "before":
            violationCondition = `d2:daysBetween(${var1Ref}, ${var2Ref}) >= 0`;
            break;
        case "after_or_equal":
            violationCondition = `d2:daysBetween(${var1Ref}, ${var2Ref}) < 0`;
            break;
        case "after":
            violationCondition = `d2:daysBetween(${var1Ref}, ${var2Ref}) <= 0`;
            break;
        case "difference_less":
            violationCondition = `d2:${differenceUnit}Between(${var1Ref}, ${var2Ref}) >= ${differenceValue}`;
            break;
        case "difference_less_equal":
            violationCondition = `d2:${differenceUnit}Between(${var1Ref}, ${var2Ref}) > ${differenceValue}`;
            break;
        case "difference_more":
            violationCondition = `d2:${differenceUnit}Between(${var1Ref}, ${var2Ref}) <= ${differenceValue}`;
            break;
        case "difference_more_equal":
            violationCondition = `d2:${differenceUnit}Between(${var1Ref}, ${var2Ref}) < ${differenceValue}`;
            break;
    }
    
    return `${hasValueCondition} && ${violationCondition}`;
}

function getVariableReference(variable) {
    // System variables use V{} syntax
    if (variable.type === "enrollment") return "V{enrollment_date}";
    if (variable.type === "incident") return "V{incident_date}";
    if (variable.type === "event_date") return "V{event_date}";
    if (variable.type === "due_date") return "V{due_date}";
    if (variable.type === "current_date") return "V{current_date}";
    
    // User variables use #{} syntax with PRV name
    return `#{${variable.prvName}}`;
}

function isSystemVariable(variable) {
    return ["enrollment", "incident", "event_date", "due_date", "current_date"].includes(variable.type);
}


/**
 * Saves a configuration of prefix etc for a program
 * @param {string} programId - The ID of the program
 * @param {Object} config - The configuration to be saved
 */
async function progSetConfig(programId, config) {
    const namespace = "tracker-date-validation";
    const key = `config-${programId}`;
    
    try {
        await d2PutJson(`dataStore/${namespace}/${key}`, config);
        return config;
    } catch (error) {
        console.error("Error saving program config:", error);
        throw error;
    }
}

/**
 * Loads a configuration of prefix etc for a program
 * @param {string} programId - The ID of the program
 * @returns {Object} The configuration object
 */
async function progGetConfig(programId) {
    const namespace = "tracker-date-validation";
    const key = `config-${programId}`;
    
    try {
        const config = await d2Get(`dataStore/${namespace}/${key}`);
        return config;
    } catch (error) {
        // Return default config if not found
        return {
            programRulePrefix: "",
            programRuleVariablePrefix: ""
        };
    }
}

/**
 * Gets all programmes from the instance; name and id only
 * @returns {Array} An array of programs with name and id
 */
async function programsAllGet() {
    try {
        const response = await d2Get("programs?fields=id,name&filter=programType:eq:WITH_REGISTRATION&paging=false");
        return response.programs || [];
    } catch (error) {
        console.error("Error fetching programs:", error);
        throw error;
    }
}

/**
 * Gets all required metadata for one particular programme
 * @param {string} programId - The ID of the program
 * @returns {Object} The program metadata
 */
async function programGet(programId) {
    try {
        // Fetch program metadata
        const programFields = "name,id,programStages[name,id,executionDateLabel,hideDueDate,programStageDataElements[dataElement[id,name,valueType]],programStageSections[id,name,dataElements[id]]],trackedEntityType[trackedEntityTypeAttributes[id,name,valueType]],programTrackedEntityAttributes[trackedEntityAttribute[id,name,valueType]],enrollmentDateLabel,incidentDateLabel,displayIncidentDate,ignoreOverdueEvents";
        
        const [program, programRules, programRuleVariables, programRuleActions] = await Promise.all([
            d2Get(`programs/${programId}?fields=${programFields}`),
            d2Get(`programRules?filter=program.id:eq:${programId}&fields=:owner&paging=false`),
            d2Get(`programRuleVariables?filter=program.id:eq:${programId}&fields=:owner&paging=false`),
            d2Get(`programRuleActions?filter=programRule.program.id:eq:${programId}&fields=:owner&paging=false`)
        ]);
        
        return {
            ...program,
            programRules: programRules.programRules || [],
            programRuleVariables: programRuleVariables.programRuleVariables || [],
            programRuleActions: programRuleActions.programRuleActions || []
        };
    } catch (error) {
        console.error("Error fetching program metadata:", error);
        throw error;
    }
}

/**
 * Fetches a new UID from the /system/id API endpoint and returns it.
 * @returns {string} The new UID
 */
async function getId() {
    try {
        const response = await d2Get("system/id");
        return response.codes[0];
    } catch (error) {
        console.error("Error fetching new UID:", error);
        throw error;
    }
}
