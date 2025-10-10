// Stage- and target-aware rule detection

export function prGetExisting(programMetadata, variable) {
    if (!programMetadata || !variable) return [];
    const { type, id } = variable;
    
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

        // Pass rule to isVariablePrimaryTarget for event_date stage check
        matches = isVariablePrimaryTarget(rule.condition, variable, relatedPrvs, rule);

        if (matches) result.push({ rule, actions });
    });
    
    return result;
}

function isVariablePrimaryTarget(condition, variable, relatedPrvs, rule) {
    const { type } = variable;
    
    // Parse d2:daysBetween conditions to check if this variable is the first parameter
    const daysBetweenMatch = condition.match(/d2:daysBetween\(([^,]+),\s*([^)]+)\)/);
    if (daysBetweenMatch) {
        const [, ref1] = daysBetweenMatch;
        const var1Ref = ref1.trim();
        
        // Check if first variable matches our target variable
        if (type === "enrollment" && (var1Ref === "enrollment_date" || var1Ref === "V{enrollment_date}")) return true;
        if (type === "incident" && (var1Ref === "incident_date" || var1Ref === "V{incident_date}")) return true;
        if (type === "event_date" && (var1Ref === "event_date" || var1Ref === "V{event_date}")) {
            // Only match if rule is limited to the same programStage
            if (variable.stageId && rule && rule.programStage && rule.programStage.id === variable.stageId) {
                return true;
            }
            // If no stageId or rule not limited to a stage, do not match
            return false;
        }
        if (type === "current_date" && (var1Ref === "current_date" || var1Ref === "V{current_date}")) return true;
        
        // For data elements and attributes, check if the PRV name matches (including underscores)
        if ((type === "dataElement" || type === "data_element" || type === "trackedEntityAttribute" || type === "attribute")) {
            // Remove only curly braces and hash, keep underscores and all other chars
            const prvName = var1Ref.replace(/[{}#]/g, "");
            return relatedPrvs.some(prv => prv.name === prvName);
        }
    }
    
    // Parse interval-based conditions (d2:*Between)
    const intervalMatch = condition.match(/d2:(days|weeks|months|years)Between\(([^,]+),\s*([^)]+)\)/);
    if (intervalMatch) {
        const [, , ref1] = intervalMatch;
        const var1Ref = ref1.trim();
        
        // Same logic as above for interval conditions
        if (type === "enrollment" && (var1Ref === "enrollment_date" || var1Ref === "V{enrollment_date}")) return true;
        if (type === "incident" && (var1Ref === "incident_date" || var1Ref === "V{incident_date}")) return true;
        if (type === "event_date" && (var1Ref === "event_date" || var1Ref === "V{event_date}")) return true;
        if (type === "current_date" && (var1Ref === "current_date" || var1Ref === "V{current_date}")) return true;
        
        if ((type === "dataElement" || type === "data_element" || type === "trackedEntityAttribute" || type === "attribute")) {
            // Remove only curly braces and hash, keep underscores and all other chars
            const prvName = var1Ref.replace(/[{}#]/g, "");
            return relatedPrvs.some(prv => prv.name === prvName);
        }
    }
    
    return false;
}
