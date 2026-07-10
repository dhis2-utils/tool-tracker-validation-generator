// Pure functions for building rule expressions and labels

export function isSystemVariable(variable) {
    return ["enrollment", "incident", "event_date", "due_date", "current_date", "fixed_date", "relative_current_date"].includes(variable?.type);
}

export function getVariableReference(variable) {
    if (!variable) return "";
    switch (variable.type) {
    case "enrollment": return "V{enrollment_date}";
    case "incident": return "V{incident_date}";
    case "event_date": return "V{event_date}";
    case "due_date": return "V{due_date}";
    case "current_date": return "V{current_date}";
    case "fixed_date":
        return `'${variable.id}'`;
    case "relative_current_date": {
        const unitFn = variable.relativeUnit === "days" ? "d2:addDays"
            : variable.relativeUnit === "months" ? "d2:addMonths"
                : "d2:addYears";
        const amount = variable.relativeDirection === "past"
            ? -Math.abs(variable.relativeAmount)
            : Math.abs(variable.relativeAmount);
        return `${unitFn}(V{current_date}, ${amount})`;
    }
    case "dataElement":
    case "trackedEntityAttribute":
        return `#{${variable.prvName || variable.name || variable.id}}`;
    default:
        return `#{${variable.prvName || variable.name || variable.id}}`;
    }
}

export function generateIntervalCondition(startDateRef, endDateRef, amount, unit) {
    const fn = unit === "weeks" ? "d2:weeksBetween"
        : unit === "months" ? "d2:monthsBetween"
            : unit === "years" ? "d2:yearsBetween"
                : "d2:daysBetween";
    return `${fn}(${startDateRef}, ${endDateRef}) > ${amount}`;
}

function buildNullGuard(variable) {
    if (isSystemVariable(variable)) return null;
    const ref = getVariableReference(variable);
    return `d2:hasValue(${ref})`;
}

export function generateNewRuleCondition(variable1, variable2, config) {
    const var1Ref = getVariableReference(variable1);
    const var2Ref = getVariableReference(variable2);
    const guard = buildNullGuard(variable1);

    let condition;
    switch (config.operator) {
    case "before": condition = `d2:daysBetween(${var1Ref}, ${var2Ref}) < 0`; break;
    case "after": condition = `d2:daysBetween(${var1Ref}, ${var2Ref}) > 0`; break;
    case "on_or_after": condition = `d2:daysBetween(${var1Ref}, ${var2Ref}) >= 0`; break;
    case "on_or_before": condition = `d2:daysBetween(${var1Ref}, ${var2Ref}) <= 0`; break;
    case "within_before": condition = generateIntervalCondition(var2Ref, var1Ref, config.intervalAmount, config.intervalUnit); break;
    case "within_after": condition = generateIntervalCondition(var1Ref, var2Ref, config.intervalAmount, config.intervalUnit); break;
    default: throw new Error(`Unknown operator: ${config.operator}`);
    }

    return guard ? `${guard} && ${condition}` : condition;
}

export function generateRuleName(variable1, variable2, validationType, customName = null) {
    if (customName) {
        // Don't add signature to the name, just return the custom name
        return customName;
    }

    const getDisplayName = variable => {
        if (!variable) return "";
        if (variable.stageName && ["dataElement", "event_date", "due_date"].includes(variable.type)) {
            return `${variable.name} (${variable.stageName})`;
        }
        return variable.name;
    };
    
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
    return `Date validation: ${getDisplayName(variable1)} ${label} ${getDisplayName(variable2)}`;
}

export function generateValidationMessage(variable1, variable2, validationType, differenceValue, differenceUnit) {
    const base = generateRuleName(variable1, variable2, validationType).replace("Date validation: ", "");
    if (validationType?.startsWith("difference_")) return `${base} ${differenceValue} ${differenceUnit}`;
    return base;
}

export function getValidationStageId(variable1, variable2) {
    const pick = v => (v?.type === "dataElement" || v?.type === "event_date" || v?.type === "due_date") ? v.stageId : null;
    return pick(variable1) || pick(variable2) || null;
}

const NUMERIC_OP_MAP = {
    "greater_than": ">",
    "greater_than_or_equal": ">=",
    "less_than": "<",
    "less_than_or_equal": "<=",
    "equal_to": "==",
    "not_equal_to": "!="
};

export function generateNumericCondition(variable, operator, value) {
    const varRef = getVariableReference(variable);
    const op = NUMERIC_OP_MAP[operator];
    if (!op) throw new Error(`Unknown numeric operator: ${operator}`);
    return `d2:hasValue(${varRef}) && ${varRef} ${op} ${value}`;
}

export function generateNumericFieldCondition(variable1, operator, variable2) {
    const var1Ref = getVariableReference(variable1);
    const var2Ref = getVariableReference(variable2);
    const op = NUMERIC_OP_MAP[operator];
    if (!op) throw new Error(`Unknown numeric operator: ${operator}`);
    return `d2:hasValue(${var1Ref}) && ${var1Ref} ${op} ${var2Ref}`;
}
