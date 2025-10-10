// Pure functions for building rule expressions and labels

export function getVariableReference(variable) {
    if (!variable) return "";
    switch (variable.type) {
    case "enrollment": return "V{enrollment_date}";
    case "incident": return "V{incident_date}";
    case "event_date": return "V{event_date}";
    case "due_date": return "V{due_date}";
    case "current_date": return "V{current_date}";
    case "dataElement":
    case "trackedEntityAttribute":
    case "data_element":
    case "attribute":
        return `#{${variable.prvName || variable.name || variable.id}}`;
    default:
        return `#{${variable.prvName || variable.name || variable.id}}`;
    }
}

export function isSystemVariable(variable) {
    return ["enrollment", "incident", "event_date", "due_date", "current_date"].includes(variable?.type);
}

export function generateIntervalCondition(startDateRef, endDateRef, amount, unit) {
    const fn = unit === "weeks" ? "d2:weeksBetween"
        : unit === "months" ? "d2:monthsBetween"
            : unit === "years" ? "d2:yearsBetween"
                : "d2:daysBetween";
    return `${fn}(${startDateRef}, ${endDateRef}) > ${amount}`;
}

export function generateNewRuleCondition(variable1, variable2, config) {
    const var1Ref = getVariableReference(variable1);
    const var2Ref = getVariableReference(variable2);
    switch (config.operator) {
    case "before": return `d2:daysBetween(${var1Ref}, ${var2Ref}) < 0`;
    case "after": return `d2:daysBetween(${var1Ref}, ${var2Ref}) > 0`;
    case "on_or_after": return `d2:daysBetween(${var1Ref}, ${var2Ref}) >= 0`;
    case "on_or_before": return `d2:daysBetween(${var1Ref}, ${var2Ref}) <= 0`;
    case "within_before": return generateIntervalCondition(var2Ref, var1Ref, config.intervalAmount, config.intervalUnit);
    case "within_after": return generateIntervalCondition(var1Ref, var2Ref, config.intervalAmount, config.intervalUnit);
    default: throw new Error(`Unknown operator: ${config.operator}`);
    }
}

export function generateRuleName(variable1, variable2, validationType, customName = null) {
    if (customName) {
        // Don't add signature to the name, just return the custom name
        return customName;
    }
    
    const labels = {
        before: "should be before",
        on_or_before: "should be on or before", 
        after: "should be after",
        on_or_after: "should be on or after",
        difference_less: "difference should be less than",
        difference_less_equal: "difference should be less than or equal to",
        difference_more: "difference should be more than",
        difference_more_equal: "difference should be more than or equal to"
    };
    const label = labels[validationType] || validationType;
    return `Date validation: ${variable1?.name} ${label} ${variable2?.name}`;
}

export function generateValidationMessage(variable1, variable2, validationType, differenceValue, differenceUnit) {
    const base = generateRuleName(variable1, variable2, validationType).replace("Date validation: ", "");
    if (validationType?.startsWith("difference_")) return `${base} ${differenceValue} ${differenceUnit}`;
    return base;
}

export function getValidationStageId(variable1, variable2) {
    const pick = v => (v?.type === "dataElement" || v?.type === "data_element" || v?.type === "event_date") ? v.stageId : null;
    return pick(variable1) || pick(variable2) || null;
}
