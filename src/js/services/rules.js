import { d2PostJson, d2Get } from "../d2api.js";

export async function getId() {
    const r = await d2Get("/api/system/id");
    return r.codes?.[0];
}

export function prvGetSet(programMetadata, programId, programRuleVariablePrefix, type, id, nameFallback) {
    const existing = (programMetadata.programRuleVariables || []).find(prv =>
        (type === "dataElement" && prv.dataElement?.id === id) ||
        (type === "trackedEntityAttribute" && prv.trackedEntityAttribute?.id === id)
    );
    if (existing) return existing;
    const name = `${programRuleVariablePrefix || ""}${nameFallback || id}`;
    return {
        id: null,
        name,
        program: { id: programId },
        programRuleVariableSourceType: type === "dataElement" ? "DATAELEMENT_CURRENT_EVENT" : "TEI_ATTRIBUTE",
        dataElement: type === "dataElement" ? { id } : undefined,
        trackedEntityAttribute: type === "trackedEntityAttribute" ? { id } : undefined,
        valueType: "DATE"
    };
}

export async function ensureProgramRuleVariable(programMetadata, programId, programRuleVariablePrefix, variable, idFn = getId) {
    if (["enrollment", "incident", "event_date", "due_date", "current_date"].includes(variable.type)) {
        return { name: variable.prvName || variable.type };
    }
    const type = (variable.type === "data_element") ? "dataElement" : (variable.type === "attribute" ? "trackedEntityAttribute" : variable.type);
    let prv = prvGetSet(programMetadata, programId, programRuleVariablePrefix, type, variable.id, variable.name || variable.id);
    if (!prv.id) {
        prv.id = await idFn();
        const created = await d2PostJson("/api/programRuleVariables", prv);
        programMetadata.programRuleVariables.push(created);
        return created;
    }
    return prv;
}

export async function prCreate(programMetadata, programRule, programRuleActions, programRuleVariables = [], idFn = getId) {
    // Create PRVs first
    for (const prv of programRuleVariables) {
        if (!prv.id) {
            prv.id = await idFn();
            const created = await d2PostJson("/api/programRuleVariables", prv);
            programMetadata.programRuleVariables.push(created);
        }
    }
    programRule.id = await idFn();
    const createdRule = await d2PostJson("/api/programRules", programRule);
    programMetadata.programRules.push(createdRule);

    // Create actions
    for (const pra of programRuleActions) {
        pra.id = await idFn();
        pra.programRule = { id: programRule.id };
        const created = await d2PostJson("/api/programRuleActions", pra);
        programMetadata.programRuleActions.push(created);
    }
    return createdRule;
}
