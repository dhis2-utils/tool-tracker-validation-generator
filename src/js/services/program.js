import { d2Get, d2PutJson, d2PostJson } from "../d2api.js";

export async function programsAllGet() {
    const res = await d2Get("/api/programs?fields=id,name,programType&filter=programType:eq:WITH_REGISTRATION&paging=false");
    return res.programs || [];
}

export async function programGet(programId) {
    const fields = "name,id,programStages[name,id,executionDateLabel,hideDueDate,programStageDataElements[dataElement[id,name,valueType]],programStageSections[id,name,dataElements[id]]],trackedEntityType[trackedEntityTypeAttributes[id,name,valueType]],programTrackedEntityAttributes[trackedEntityAttribute[id,name,valueType]],enrollmentDateLabel,incidentDateLabel,displayIncidentDate,ignoreOverdueEvents";
    const [p, rules, vars, acts] = await Promise.all([
        d2Get(`/api/programs/${programId}?fields=${fields}`),
        d2Get(`/api/programRules?filter=program.id:eq:${programId}&fields=:owner&paging=false`),
        d2Get(`/api/programRuleVariables?filter=program.id:eq:${programId}&fields=:owner&paging=false`),
        d2Get(`/api/programRuleActions?filter=programRule.program.id:eq:${programId}&fields=:owner&paging=false`)
    ]);
    return {
        ...p,
        programRules: rules.programRules || [],
        programRuleVariables: vars.programRuleVariables || [],
        programRuleActions: acts.programRuleActions || []
    };
}

export async function progGetConfig(programId) {
    const ns = "tracker-date-validation";
    const key = `config-${programId}`;
    try {
        return await d2Get(`/api/dataStore/${ns}/${key}`);
    } catch {
        return { programRulePrefix: "", programRuleVariablePrefix: "" };
    }
}

export async function progSetConfig(programId, config) {
    const ns = "tracker-date-validation";
    const key = `config-${programId}`;
    try {
        await d2PutJson(`/api/dataStore/${ns}/${key}`, config);
    } catch {
        // Key does not exist yet — create with POST
        await d2PostJson(`/api/dataStore/${ns}/${key}`, config);
    }
    return config;
}

export async function getId() {
    const r = await d2Get("/api/system/id");
    return r.codes?.[0];
}
