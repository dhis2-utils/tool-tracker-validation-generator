// Program rule signature and edit detection utilities

export function getAppSignature() {
    return "DVT";
}

export function addAppSignature(ruleName, description) {
    const signature = getAppSignature();
    const signaturePrefix = `[${signature}]`;
    
    // Only add signature to description, not name
    const descWithSignature = description && !description.startsWith(signaturePrefix)
        ? `${signaturePrefix} ${description}`
        : description || `${signaturePrefix} Date validation rule`;
    
    return { name: ruleName, description: descWithSignature };
}

export function isAppGenerated(rule) {
    const signature = getAppSignature();
    const signaturePrefix = `[${signature}]`;
    
    // Check if the description starts with our signature
    return rule.description && rule.description.startsWith(signaturePrefix);
}

export const BATCH_TAG = "DVT-BATCH";

export function isBatchGenerated(rule) {
    const batchPrefix = `[${BATCH_TAG}]`;
    return isAppGenerated(rule) && rule.description.includes(batchPrefix);
}

export function addBatchSignature(ruleName, description) {
    const { name, description: signedDesc } = addAppSignature(ruleName, description);
    const batchPrefix = `[${BATCH_TAG}]`;
    // Insert [DVT-BATCH] after [DVT] in the description
    const descWithBatch = signedDesc.replace(/^\[DVT\]\s*/, `[DVT] ${batchPrefix} `);
    return { name, description: descWithBatch };
}

export function removeAppSignature(text) {
    if (!text) return text;
    const signature = getAppSignature();
    const signaturePrefix = `[${signature}]`;
    if (text.startsWith(signaturePrefix)) {
        return text.substring(signaturePrefix.length).trim();
    }
    return text;
}

export function getConfigurationSignature(variable1, variable2, config) {
    // Create a unique signature based on the configuration parameters
    const parts = [
        variable1.type,
        variable1.id,
        variable1.stageId || "null",
        config.operator,
        variable2.type,
        variable2.id,
        variable2.stageId || "null"
    ];
    
    if (config.intervalAmount && config.intervalUnit) {
        parts.push(config.intervalAmount.toString(), config.intervalUnit);
    }
    
    return parts.join("|");
}

export function findDuplicateRule(programMetadata, variable, config) {
    if (!programMetadata || !variable || !config) return null;
    
    const { comparisonDate } = config;
    const [compareType, compareId, compareStageId] = comparisonDate.split(":");
    
    // Create comparison variable object
    const compareVariable = {
        type: compareType,
        id: compareId,
        stageId: compareStageId
    };
    
    // Look for existing rules that target the same variables regardless of who created them
    const existingValidations = prGetExisting(programMetadata, variable);
    
    for (const validation of existingValidations) {
        const { rule } = validation;
        
        // Try to extract configuration from the rule condition
        const ruleConfig = parseRuleCondition(rule.condition, programMetadata, variable);
        if (!ruleConfig) continue;
        
        // Check if this rule uses the same two variables AND the same operator
        const sameVariables = (
            (ruleConfig.variable1.type === variable.type && ruleConfig.variable1.id === variable.id && 
             ruleConfig.variable1.stageId === variable.stageId) &&
            (ruleConfig.variable2.type === compareVariable.type && ruleConfig.variable2.id === compareVariable.id && 
             ruleConfig.variable2.stageId === compareVariable.stageId)
        ) || (
            // Also check reversed order
            (ruleConfig.variable1.type === compareVariable.type && ruleConfig.variable1.id === compareVariable.id && 
             ruleConfig.variable1.stageId === compareVariable.stageId) &&
            (ruleConfig.variable2.type === variable.type && ruleConfig.variable2.id === variable.id && 
             ruleConfig.variable2.stageId === variable.stageId)
        );
        const sameOperator = ruleConfig.config?.operator === config.operator;
        if (sameVariables && sameOperator) {
            return rule;
        }
    }
    
    return null;
}

const NUMERIC_OP_REVERSE_MAP = {
    ">": "greater_than", ">=": "greater_than_or_equal",
    "<": "less_than", "<=": "less_than_or_equal",
    "==": "equal_to", "!=" : "not_equal_to"
};

export function parseRuleCondition(condition, programMetadata, targetVariable = null) {
    // Strip leading d2:hasValue() guard before parsing
    const strippedCondition = condition.replace(/^d2:hasValue\([^)]+\)\s*&&\s*/, "");
    condition = strippedCondition;
    
    // Parse d2:daysBetween date comparison conditions (robust)
    const daysBetweenMatch = condition.match(/d2:daysBetween\(([^,]+),\s*([^)]+)\)\s*(>=|<=|>|<)\s*(-?\d+)/);
    if (daysBetweenMatch) {
        const [, ref1, ref2, op, value] = daysBetweenMatch;
        // Clean up variable references
        const var1Ref = ref1.trim().replace(/^V\{|\}$/g, "");
        const var2Ref = ref2.trim().replace(/^V\{|\}$/g, "");
        const variable1 = parseVariableReference(var1Ref, programMetadata);
        const variable2 = parseVariableReference(var2Ref, programMetadata);
        if (!variable1 || !variable2) return null;
        let operator;
        const numValue = parseInt(value);
        // Support all valid patterns
        if (op === "<" && numValue === 0) {
            operator = "before";
        } else if (op === ">" && numValue === 0) {
            operator = "after";
        } else if (op === ">=" && numValue === 0) {
            operator = "on_or_after";
        } else if (op === "<=" && numValue === 0) {
            operator = "on_or_before";
        } else if (op === ">" && numValue > 0) {
            // This could be an interval condition - check if we have targetVariable context
            if (targetVariable) {
                const ref2IsTarget = variable2.id === targetVariable.id && variable2.type === targetVariable.type;
                operator = ref2IsTarget ? "within_before" : "within_after";
            } else {
                operator = "within_after"; // default
            }
        } else if (op === "<" && numValue < 0) {
            // This could be an interval condition - check if we have targetVariable context
            if (targetVariable) {
                const ref2IsTarget = variable2.id === targetVariable.id && variable2.type === targetVariable.type;
                operator = ref2IsTarget ? "within_before" : "within_after";
            } else {
                operator = "within_after"; // default
            }
        } else {
            // Accept any numeric comparison for editing, fallback to generic
            operator = "custom";
        }
        // Add interval-specific fields for interval operators
        const config = { operator, value: numValue };
        if (operator === "within_after" || operator === "within_before") {
            config.intervalAmount = numValue;
            config.intervalUnit = "days"; // Default to days for daysBetween function
        }
        
        return {
            variable1,
            variable2,
            config
        };
    }
    
    // Parse interval-based conditions (d2:daysBetween/d2:weeksBetween/etc with amounts > 0)
    const intervalMatch = condition.match(/d2:(days|weeks|months|years)Between\(([^,]+),\s*([^)]+)\)\s*(>=|<=|>|<|==|!=)\s*(-?\d+)/);
    if (intervalMatch) {
        const [, unit, ref1, ref2, amount] = intervalMatch;
        // Clean up variable references
        const var1Ref = ref1.trim().replace(/^V\{|\}$/g, "");
        const var2Ref = ref2.trim().replace(/^V\{|\}$/g, "");
        const parsedRef1 = parseVariableReference(var1Ref, programMetadata);
        const parsedRef2 = parseVariableReference(var2Ref, programMetadata);
        if (!parsedRef1 || !parsedRef2) return null;

        // Determine direction using targetVariable context:
        // within_after:  d2:*Between(targetRef, compareRef) — target is ref1 (first arg)
        // within_before: d2:*Between(compareRef, targetRef) — target is ref2 (second arg)
        let operator = "within_after"; // default (no context)
        let variable1 = parsedRef1; // target (validated date)
        let variable2 = parsedRef2; // comparison date

        if (targetVariable) {
            const ref2IsTarget = parsedRef2.id === targetVariable.id && parsedRef2.type === targetVariable.type;
            if (ref2IsTarget) {
                operator = "within_before";
                variable1 = parsedRef2; // swap: return target first
                variable2 = parsedRef1;
            }
        }

        return {
            variable1,
            variable2,
            config: {
                operator,
                intervalAmount: parseInt(amount),
                intervalUnit: unit
            }
        };
    }

    // Parse numeric field-to-field: #{VAR1} OP #{VAR2}
    const numericFieldMatch = condition.match(/#{([^}]+)}\s*(>=|<=|>|<|==|!=)\s*#{([^}]+)}/);
    if (numericFieldMatch) {
        const [, prvName1, op, prvName2] = numericFieldMatch;
        const variable1 = parseVariableReference(prvName1, programMetadata);
        const variable2 = parseVariableReference(prvName2, programMetadata);
        if (!variable1 || !variable2) return null;
        const operator = NUMERIC_OP_REVERSE_MAP[op] || op;
        return { variable1, variable2, config: { operator, comparisonType: "field" } };
    }

    // Parse numeric literal: #{VAR} OP number
    const numericLiteralMatch = condition.match(/#{([^}]+)}\s*(>=|<=|>|<|==|!=)\s*(-?\d+(?:\.\d+)?)/);
    if (numericLiteralMatch) {
        const [, prvName, op, rawValue] = numericLiteralMatch;
        const variable1 = parseVariableReference(prvName, programMetadata);
        if (!variable1) return null;
        const operator = NUMERIC_OP_REVERSE_MAP[op] || op;
        return { variable1, variable2: null, config: { operator, comparisonType: "value", value: parseFloat(rawValue) } };
    }
    
    return null;
}

function parseVariableReference(varRef, programMetadata) {
    // Handle system variables
    if (varRef === "enrollment_date") return { type: "enrollment", id: "enrollment_date" };
    if (varRef === "incident_date") return { type: "incident", id: "incident_date" };
    if (varRef === "event_date") return { type: "event_date", id: "event_date" };
    if (varRef === "current_date") return { type: "current_date", id: "current_date" };
    
    // Handle program rule variables (data elements and attributes)
    const prvName = varRef.replace(/[#{}]/g, "");
    // Only match by PRV name
    const prv = programMetadata.programRuleVariables?.find(v => v.name === prvName);
    if (!prv) return null;
    if (prv.dataElement) {
        return {
            type: "dataElement",
            id: prv.dataElement.id,
            stageId: prv.programStage?.id
        };
    }
    if (prv.trackedEntityAttribute) {
        return {
            type: "trackedEntityAttribute", 
            id: prv.trackedEntityAttribute.id
        };
    }
    return null;
}

// Import detector for integration
import { prGetExisting } from "./detector.js";