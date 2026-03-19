import { prGetExisting as detectExisting } from "../rules/detector.js";

export function showOverview() {
    document.getElementById("dateVariablesOverview").style.display = "block";
    document.getElementById("dateVariableDetails").style.display = "none";
}

export function renderDateVariables(programMetadata, programConfig) {
    if (!programMetadata) return;
    
    // Check if settings are configured
    const settingsConfigured = programConfig && programConfig.programRuleVariablePrefix && programConfig.programRuleVariablePrefix.trim().length > 0;
    
    // Show settings warning if not configured
    const settingsWarning = document.getElementById("settingsWarning");
    if (settingsWarning) {
        if (!settingsConfigured) {
            settingsWarning.style.display = "block";
            settingsWarning.innerHTML = "<div class=\"alert alert-warning\">⚠ <strong>Settings Required:</strong> Please configure program settings by clicking the Settings button above before creating validation rules.</div>";
        } else {
            settingsWarning.style.display = "none";
        }
    }
    
    renderEnrollmentDates(programMetadata);
    renderProgramStages(programMetadata);
    updateValidationIndicators(programMetadata);
}

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

export function renderEnrollmentDates(programMetadata) {
    const container = document.getElementById("enrollmentDates");
    container.innerHTML = "";
    const enrollmentDates = [];
    if (programMetadata.enrollmentDateLabel) {
        enrollmentDates.push({ name: programMetadata.enrollmentDateLabel, type: "enrollment", id: "enrollment_date" });
    }
    if (programMetadata.displayIncidentDate && programMetadata.incidentDateLabel) {
        enrollmentDates.push({ name: programMetadata.incidentDateLabel, type: "incident", id: "incident_date" });
    }
    (programMetadata.programTrackedEntityAttributes || []).forEach(pTea => {
        const tea = pTea.trackedEntityAttribute;
        if (!tea) return;
        if (tea.valueType === "DATE") {
            enrollmentDates.push({ name: tea.name, type: "trackedEntityAttribute", id: tea.id, category: "date", valueType: "DATE" });
        } else if (["INTEGER","INTEGER_POSITIVE","INTEGER_ZERO_OR_POSITIVE","INTEGER_NEGATIVE","NUMBER","PERCENTAGE"].includes(tea.valueType)) {
            enrollmentDates.push({ name: tea.name, type: "trackedEntityAttribute", id: tea.id, category: "numeric", valueType: tea.valueType });
        }
    });
    enrollmentDates.forEach(dateVar => container.appendChild(createDateVariableElement(dateVar)));
}

export function renderProgramStages(programMetadata) {
    const container = document.getElementById("programStages");
    container.innerHTML = "";
    (programMetadata.programStages || []).forEach(stage => {
        const stageCard = document.createElement("div");
        stageCard.className = "stage-section-wrap";
        const dateElements = [];
        dateElements.push({ name: stage.executionDateLabel || "Event date", type: "event_date", id: `event_date_${stage.id}`, stageId: stage.id });
        if (!stage.hideDueDate) dateElements.push({ name: "Due date", type: "due_date", id: `due_date_${stage.id}`, stageId: stage.id });
        (stage.programStageDataElements || []).forEach(psde => {
            const de = psde.dataElement;
            if (!de) return;
            if (de.valueType === "DATE") {
                dateElements.push({ name: de.name, type: "dataElement", id: de.id, stageId: stage.id, category: "date", valueType: "DATE" });
            } else if (["INTEGER","INTEGER_POSITIVE","INTEGER_ZERO_OR_POSITIVE","INTEGER_NEGATIVE","NUMBER","PERCENTAGE"].includes(de.valueType)) {
                dateElements.push({ name: de.name, type: "dataElement", id: de.id, stageId: stage.id, category: "numeric", valueType: de.valueType });
            }
        });
        if (dateElements.length > 0) {
            const varsHtml = dateElements.map(renderStageVarHtml).join("");
            stageCard.innerHTML = `
                <details class="stage-section">
                    <summary class="stage-summary">
                        <span class="stage-toggle">▶</span>
                        ${stage.name}
                        <span class="variable-badge" style="margin-left:auto;background:#f1f4f8;color:var(--text-3)">${dateElements.length}</span>
                    </summary>
                    <div class="stage-vars">${varsHtml}</div>
                </details>`;
            container.appendChild(stageCard);
        }
    });
    document.querySelectorAll(".date-variable").forEach(element => {
        element.addEventListener("click", () => {
            const variableData = JSON.parse(element.dataset.variable);
            // Defer to app.js exported handler to keep orchestration centralized
            window.__showVariableDetails && window.__showVariableDetails(variableData);
        });
    });
}

export function createDateVariableElement(dateVar) {
    const div = document.createElement("div");
    div.className = "date-variable";
    div.dataset.variable = JSON.stringify(dateVar);
    const badgeClass = dateVar.category === "numeric" ? "variable-badge-numeric" : "variable-badge-date";
    const badgeLabel = dateVar.category === "numeric" ? "Numeric" : "Date";
    div.innerHTML = `
        <strong>${dateVar.name}</strong>
        <span class="var-type-label">(${getVariableTypeLabel(dateVar.type)})</span>
        <span class="validation-count" style="margin-left:auto;display:none"></span>
        <span class="variable-badge ${badgeClass}">${badgeLabel}</span>`;
    div.addEventListener("click", () => {
        window.__showVariableDetails && window.__showVariableDetails(dateVar);
    });
    return div;
}

function getVariableTypeLabel(type) {
    const labels = { enrollment: "Enrollment Date", incident: "Incident Date", trackedEntityAttribute: "Tracked Entity Attribute", attribute: "Tracked Entity Attribute", event_date: "Event Date", due_date: "Due Date", dataElement: "Data Element", data_element: "Data Element" };
    return labels[type] || type;
}

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
