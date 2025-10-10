import { prGetExisting as detectExisting } from "../rules/detector.js";

export function showOverview() {
    document.getElementById("dateVariablesOverview").style.display = "block";
    document.getElementById("dateVariableDetails").style.display = "none";
}

export function renderDateVariables(programMetadata) {
    if (!programMetadata) return;
    renderEnrollmentDates(programMetadata);
    renderProgramStages(programMetadata);
    updateValidationIndicators(programMetadata);
}

export function updateValidationIndicators(programMetadata) {
    document.querySelectorAll(".date-variable").forEach(element => {
        const variableData = JSON.parse(element.dataset.variable);
        const validations = detectExisting(programMetadata, variableData);
        if (validations.length > 0) {
            element.classList.add("has-validation");
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
        if (pTea.trackedEntityAttribute?.valueType === "DATE") {
            enrollmentDates.push({ name: pTea.trackedEntityAttribute.name, type: "attribute", id: pTea.trackedEntityAttribute.id });
        }
    });
    enrollmentDates.forEach(dateVar => container.appendChild(createDateVariableElement(dateVar)));
}

export function renderProgramStages(programMetadata) {
    const container = document.getElementById("programStages");
    container.innerHTML = "";
    (programMetadata.programStages || []).forEach(stage => {
        const stageCard = document.createElement("div");
        stageCard.className = "card";
        const dateElements = [];
        dateElements.push({ name: stage.executionDateLabel || "Event date", type: "event_date", id: `event_date_${stage.id}`, stageId: stage.id });
        if (!stage.hideDueDate) dateElements.push({ name: "Due date", type: "due_date", id: `due_date_${stage.id}`, stageId: stage.id });
        (stage.programStageDataElements || []).forEach(psde => {
            if (psde.dataElement?.valueType === "DATE") {
                dateElements.push({ name: psde.dataElement.name, type: "data_element", id: psde.dataElement.id, stageId: stage.id });
            }
        });
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
                </div>`;
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
    div.innerHTML = `
        <strong>${dateVar.name}</strong>
        <span class="grey-text"> (${getVariableTypeLabel(dateVar.type)})</span>`;
    div.addEventListener("click", () => {
        window.__showVariableDetails && window.__showVariableDetails(dateVar);
    });
    return div;
}

function getVariableTypeLabel(type) {
    const labels = { enrollment: "Enrollment Date", incident: "Incident Date", attribute: "Tracked Entity Attribute", event_date: "Event Date", due_date: "Due Date", data_element: "Data Element" };
    return labels[type] || type;
}
