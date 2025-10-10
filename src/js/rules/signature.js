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
    
    const targetSignature = getConfigurationSignature(variable, compareVariable, config);
    
    // Look for existing rules with the same configuration signature
    const existingValidations = prGetExisting(programMetadata, variable);
    
    for (const validation of existingValidations) {
        const { rule } = validation;
        
        // Skip if not app-generated (we only check duplicates among our own rules)
        if (!isAppGenerated(rule)) continue;
        
        // Try to extract configuration from the rule condition
        const ruleConfig = parseRuleCondition(rule.condition, programMetadata);
        if (!ruleConfig) continue;
        
        const ruleSignature = getConfigurationSignature(ruleConfig.variable1, ruleConfig.variable2, ruleConfig.config);
        
        if (ruleSignature === targetSignature) {
            return rule;
        }
    }
    
    return null;
}

function parseRuleCondition(condition, programMetadata) {
    // Parse basic date comparison conditions
    const conditionMatch = condition.match(/V\{([^}]+)\}\s*(>=|<=|>|<)\s*V\{([^}]+)\}/);
    if (!conditionMatch) return null;
    
    const [, var1Ref, op, var2Ref] = conditionMatch;
    
    // Map operators back
    const operatorMap = {
        "<": "before",
        ">": "after", 
        "<=": "on_or_before",
        ">=": "on_or_after"
    };
    
    const operator = operatorMap[op];
    if (!operator) return null;
    
    // Parse variable references
    const variable1 = parseVariableReference(var1Ref, programMetadata);
    const variable2 = parseVariableReference(var2Ref, programMetadata);
    
    if (!variable1 || !variable2) return null;
    
    return {
        variable1,
        variable2,
        config: { operator }
    };
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