import { getState, setState } from "./state.js";

export function buildDateVariablesArray() {
    const { programMetadata } = getState();
    const list = [];
    if (!programMetadata) {
        setState({ dateVariables: list });
        return list;
    }

    if (programMetadata.enrollmentDateLabel) {
        const name = programMetadata.enrollmentDateLabel || "Enrollment date";
        list.push({ id: "enrollment_date", name: `${name} (enrollment date)`, type: "enrollment" });
    }
    if (programMetadata.displayIncidentDate && programMetadata.incidentDateLabel) {
        const name = programMetadata.incidentDateLabel || "Incident date";
        list.push({ id: "incident_date", name: `${name} (incident date)`, type: "incident" });
    }
    list.push({ id: "current_date", name: "Current date", type: "current_date" });

    programMetadata.programStages?.forEach(stage => {
        const eventLabel = stage.executionDateLabel || "Event date";
        list.push({ id: stage.id, name: `${eventLabel} (event date)`, type: "event_date", stageId: stage.id });
        stage.programStageDataElements?.forEach(psde => {
            if (psde.dataElement?.valueType === "DATE") {
                list.push({ id: psde.dataElement.id, name: psde.dataElement.name, type: "dataElement", stageId: stage.id });
            }
        });
    });

    programMetadata.programTrackedEntityAttributes?.forEach(ptea => {
        if (ptea.trackedEntityAttribute?.valueType === "DATE") {
            list.push({ id: ptea.trackedEntityAttribute.id, name: ptea.trackedEntityAttribute.name, type: "trackedEntityAttribute" });
        }
    });

    setState({ dateVariables: list });
    return list;
}

export function findDateVariable(id) {
    const { dateVariables } = getState();
    return (dateVariables || []).find(v => v.id === id);
}

export function findDateVariableByComponents(id, type, stageId) {
    const { dateVariables } = getState();
    if (!dateVariables) return null;
    return dateVariables.find(v => v.id === id && v.type === type && (stageId ? v.stageId === stageId : true));
}

export function findDataElementById(id) {
    const { programMetadata } = getState();
    for (const stage of (programMetadata?.programStages || [])) {
        for (const psde of (stage.programStageDataElements || [])) {
            if (psde.dataElement?.id === id) return psde.dataElement;
        }
    }
    return null;
}

export function findAttributeById(id) {
    const { programMetadata } = getState();
    for (const ptea of (programMetadata?.programTrackedEntityAttributes || [])) {
        if (ptea.trackedEntityAttribute?.id === id) return ptea.trackedEntityAttribute;
    }
    return null;
}
