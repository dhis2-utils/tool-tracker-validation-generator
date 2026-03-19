import { getState, setState } from "./state.js";

const NUMERIC_VALUE_TYPES = new Set([
    "INTEGER", "INTEGER_POSITIVE", "INTEGER_ZERO_OR_POSITIVE",
    "INTEGER_NEGATIVE", "NUMBER", "PERCENTAGE"
]);

export function buildVariablesArray() {
    const { programMetadata } = getState();
    const list = [];
    if (!programMetadata) {
        setState({ dateVariables: list });
        return list;
    }

    if (programMetadata.enrollmentDateLabel) {
        list.push({
            id: "enrollment_date",
            name: `${programMetadata.enrollmentDateLabel} (enrollment date)`,
            type: "enrollment", category: "date", valueType: "DATE"
        });
    }
    if (programMetadata.displayIncidentDate && programMetadata.incidentDateLabel) {
        list.push({
            id: "incident_date",
            name: `${programMetadata.incidentDateLabel} (incident date)`,
            type: "incident", category: "date", valueType: "DATE"
        });
    }
    list.push({ id: "current_date", name: "Current date", type: "current_date", category: "date", valueType: "DATE" });

    programMetadata.programStages?.forEach(stage => {
        const eventLabel = stage.executionDateLabel || "Event date";
        list.push({
            id: `event_date_${stage.id}`, name: `${eventLabel} (event date)`,
            type: "event_date", category: "date", valueType: "DATE", stageId: stage.id
        });
        if (!stage.hideDueDate) {
            list.push({
                id: `due_date_${stage.id}`, name: "Due date",
                type: "due_date", category: "date", valueType: "DATE", stageId: stage.id
            });
        }
        stage.programStageDataElements?.forEach(psde => {
            const de = psde.dataElement;
            if (!de) return;
            if (de.valueType === "DATE") {
                list.push({ id: de.id, name: de.name, type: "dataElement", category: "date", valueType: "DATE", stageId: stage.id });
            } else if (NUMERIC_VALUE_TYPES.has(de.valueType)) {
                list.push({ id: de.id, name: de.name, type: "dataElement", category: "numeric", valueType: de.valueType, stageId: stage.id });
            }
        });
    });

    programMetadata.programTrackedEntityAttributes?.forEach(ptea => {
        const tea = ptea.trackedEntityAttribute;
        if (!tea) return;
        if (tea.valueType === "DATE") {
            list.push({ id: tea.id, name: tea.name, type: "trackedEntityAttribute", category: "date", valueType: "DATE" });
        } else if (NUMERIC_VALUE_TYPES.has(tea.valueType)) {
            list.push({ id: tea.id, name: tea.name, type: "trackedEntityAttribute", category: "numeric", valueType: tea.valueType });
        }
    });

    setState({ dateVariables: list });
    return list;
}

// Keep old function name as alias for gradual migration
export const buildDateVariablesArray = buildVariablesArray;

export function findDateVariable(id) {
    const { dateVariables } = getState();
    return (dateVariables || []).find(v => v.id === id);
}

export function findVariableByComponents(id, type, stageId) {
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
