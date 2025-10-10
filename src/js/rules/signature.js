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
        const ruleConfig = parseRuleCondition(rule.condition, programMetadata);
        if (!ruleConfig) continue;
        
        // Check if this rule uses the same two variables
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
        
        if (sameVariables) {
            return rule;
        }
    }
    
    return null;
}

function parseRuleCondition(condition, programMetadata) {
    // Parse d2:daysBetween date comparison conditions
    const daysBetweenMatch = condition.match(/d2:daysBetween\(([^,]+),\s*([^)]+)\)\s*(>=|<=|>|<)\s*(-?\d+)/);
    if (daysBetweenMatch) {
        const [, ref1, ref2, op, value] = daysBetweenMatch;
        
        // Clean up variable references
        const var1Ref = ref1.trim();
        const var2Ref = ref2.trim();
        
        const variable1 = parseVariableReference(var1Ref, programMetadata);
        const variable2 = parseVariableReference(var2Ref, programMetadata);
        
        if (!variable1 || !variable2) return null;
        
        // Map the daysBetween comparisons back to our operators
        let operator;
        const numValue = parseInt(value);
        
        if (op === "<" && numValue === 0) {
            operator = "before"; // daysBetween(var1, var2) < 0 means var1 is before var2
        } else if (op === ">" && numValue === 0) {
            operator = "after"; // daysBetween(var1, var2) > 0 means var1 is after var2
        } else if (op === ">=" && numValue === 0) {
            operator = "on_or_after"; // daysBetween(var1, var2) >= 0 means var1 is on or after var2
        } else if (op === "<=" && numValue === 0) {
            operator = "on_or_before"; // daysBetween(var1, var2) <= 0 means var1 is on or before var2
        } else {
            return null; // Unknown pattern
        }
        
        return {
            variable1,
            variable2,
            config: { operator }
        };
    }
    
    // Parse interval-based conditions (d2:*Between with amounts > 0)
    const intervalMatch = condition.match(/d2:(days|weeks|months|years)Between\(([^,]+),\s*([^)]+)\)\s*>\s*(\d+)/);
    if (intervalMatch) {
        const [, unit, ref1, ref2, amount] = intervalMatch;
        
        // Clean up variable references
        const var1Ref = ref1.trim();
        const var2Ref = ref2.trim();
        
        const variable1 = parseVariableReference(var1Ref, programMetadata);
        const variable2 = parseVariableReference(var2Ref, programMetadata);
        
        if (!variable1 || !variable2) return null;
        
        // Determine the operator based on the order of variables
        // d2:*Between(var2, var1) > amount means var1 should be within amount units after var2
        // d2:*Between(var1, var2) > amount means var2 should be within amount units after var1
        const operator = "within_after"; // Both cases are "within" validations
        
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