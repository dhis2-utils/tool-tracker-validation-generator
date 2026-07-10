import { d2PostJson, d2Get } from "../d2api.js";

export async function getId() {
    const r = await d2Get("/api/system/id");
    return r.codes?.[0];
}

export function prvGetSet(programMetadata, programId, programRuleVariablePrefix, type, id, nameFallback, valueType = "DATE") {
    const existing = (programMetadata.programRuleVariables || []).find(prv =>
        (type === "dataElement" && prv.dataElement?.id === id) ||
        (type === "trackedEntityAttribute" && prv.trackedEntityAttribute?.id === id)
    );
    if (existing) return existing;
    // Format PRV name: [PREFIX]_[NAME], uppercase, underscores, no special chars
    let cleanName = (nameFallback || id)
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
    const name = programRuleVariablePrefix ? `${programRuleVariablePrefix}_${cleanName}` : cleanName;
    return {
        id: null,
        name,
        program: { id: programId },
        programRuleVariableSourceType: type === "dataElement" ? "DATAELEMENT_CURRENT_EVENT" : "TEI_ATTRIBUTE",
        dataElement: type === "dataElement" ? { id } : undefined,
        trackedEntityAttribute: type === "trackedEntityAttribute" ? { id } : undefined,
        valueType: valueType || "DATE"
    };
}

function matchesProgramRuleVariable(prv, type, variable) {
    if (!prv) return false;
    if (type === "dataElement") {
        return prv.programRuleVariableSourceType === "DATAELEMENT_CURRENT_EVENT" && prv.dataElement?.id === variable.id;
    }
    if (type === "trackedEntityAttribute") {
        return prv.programRuleVariableSourceType === "TEI_ATTRIBUTE" && prv.trackedEntityAttribute?.id === variable.id;
    }
    return false;
}

function getProgramRuleVariableConflictReports(error) {
    return error?.response?.errorReports || error?.response?.response?.errorReports || [];
}

function buildConflictRetryName(prvName, variableId) {
    const suffix = (variableId || "ALT")
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
    return `${prvName}_${suffix}`;
}

function cacheProgramRuleVariable(programMetadata, prv) {
    programMetadata.programRuleVariables = programMetadata.programRuleVariables || [];
    if (!programMetadata.programRuleVariables.some(existing => existing.id === prv.id)) {
        programMetadata.programRuleVariables.push(prv);
    }
}

async function createProgramRuleVariableWithConflictHandling(programMetadata, programId, prv, type, variable, idFn, allowSuffixRetry = true) {
    if (!prv.id) {
        prv.id = await idFn();
    }
    try {
        const created = await d2PostJson("/api/programRuleVariables", prv);
        cacheProgramRuleVariable(programMetadata, created);
        return created;
    } catch (error) {
        const hasNameConflict = getProgramRuleVariableConflictReports(error).some(report => report.errorCode === "E4051");
        if (!hasNameConflict) {
            throw error;
        }
        const response = await d2Get(`/api/programRuleVariables?filter=program.id:eq:${programId}&filter=name:eq:${prv.name}&fields=:owner&paging=false`);
        const existing = (response.programRuleVariables || []).find(candidate => matchesProgramRuleVariable(candidate, type, variable));
        if (existing) {
            cacheProgramRuleVariable(programMetadata, existing);
            return existing;
        }
        if (!allowSuffixRetry) {
            throw error;
        }
        return createProgramRuleVariableWithConflictHandling(
            programMetadata,
            programId,
            {
                ...prv,
                id: await idFn(),
                name: buildConflictRetryName(prv.name, variable.id)
            },
            type,
            variable,
            idFn,
            false
        );
    }
}

export async function ensureProgramRuleVariable(programMetadata, programId, programRuleVariablePrefix, variable, idFn = getId) {
    if (["enrollment", "incident", "event_date", "due_date", "current_date"].includes(variable.type)) {
        return { name: variable.prvName || variable.type };
    }
    const type = (variable.type === "data_element") ? "dataElement" : (variable.type === "attribute" ? "trackedEntityAttribute" : variable.type);
    const nameFallback = type === "dataElement" && variable.stageName
        ? `${variable.stageName} ${variable.name || variable.id}`
        : (variable.name || variable.id);
    let prv = prvGetSet(programMetadata, programId, programRuleVariablePrefix, type, variable.id, nameFallback, variable.valueType);
    if (!prv.id) {
        return createProgramRuleVariableWithConflictHandling(programMetadata, programId, prv, type, variable, idFn);
    }
    return prv;
}

export async function prCreate(programMetadata, programRule, programRuleActions, programRuleVariables = [], idFn = getId) {
    // Create PRVs first
    for (const prv of programRuleVariables) {
        if (!prv.id) {
            prv.id = await idFn();
            await d2PostJson("/api/programRuleVariables", prv);
        }
    }
    programRule.id = await idFn();
    const createdRule = await d2PostJson("/api/programRules", programRule);
    programMetadata.programRules = programMetadata.programRules || [];
    programMetadata.programRules.push(createdRule);

    // Create actions
    for (const pra of programRuleActions) {
        pra.id = await idFn();
        pra.programRule = { id: programRule.id };
        const createdAction = await d2PostJson("/api/programRuleActions", pra);
        programMetadata.programRuleActions = programMetadata.programRuleActions || [];
        programMetadata.programRuleActions.push(createdAction);
    }
    return createdRule;
}
