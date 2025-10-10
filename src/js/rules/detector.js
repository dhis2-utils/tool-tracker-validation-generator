// Stage- and target-aware rule detection

export function prGetExisting(programMetadata, variable) {
    if (!programMetadata || !variable) return [];
    const { type, id, stageId } = variable;
    
    const relatedPrvs = (programMetadata.programRuleVariables || []).filter(prv =>
        ((type === "dataElement" || type === "data_element") && prv.dataElement?.id === id) ||
        ((type === "trackedEntityAttribute" || type === "attribute") && prv.trackedEntityAttribute?.id === id)
    );

    const result = [];
    (programMetadata.programRules || []).forEach(rule => {
        const actions = (programMetadata.programRuleActions || []).filter(a =>
            a.programRule?.id === rule.id &&
            ["SHOWWARNING", "SHOWERROR", "WARNINGONCOMPLETE", "ERRORONCOMPLETE"].includes(a.programRuleActionType)
        );
        if (!actions.length || !rule.condition) return;

        let matches = false;

        if (type === "enrollment") {
            matches = (rule.condition.includes("V{enrollment_date}") || rule.condition.includes("enrollment_date")) && !rule.programStage;
        } else if (type === "incident") {
            matches = (rule.condition.includes("V{incident_date}") || rule.condition.includes("incident_date")) && !rule.programStage;
        } else if (type === "event_date") {
            matches = (rule.condition.includes("V{event_date}") || rule.condition.includes("event_date")) && (!rule.programStage || rule.programStage.id === stageId);
        } else if (type === "current_date") {
            matches = (rule.condition.includes("V{current_date}") || rule.condition.includes("current_date"));
        } else if (type === "dataElement" || type === "data_element" || type === "trackedEntityAttribute" || type === "attribute") {
            matches = relatedPrvs.some(prv => rule.condition.includes(`#{${prv.name}}`) || rule.condition.includes(`A{${prv.name}}`))
                || actions.some(a => ((type === "dataElement" || type === "data_element") && a.dataElement?.id === id) || ((type === "trackedEntityAttribute" || type === "attribute") && a.trackedEntityAttribute?.id === id));
            if (matches && (type === "dataElement" || type === "data_element") && stageId) {
                matches = !rule.programStage || rule.programStage.id === stageId;
            }
        }

        if (matches) result.push({ rule, actions });
    });
    
    return result;
}
