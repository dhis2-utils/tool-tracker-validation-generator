import { prGetExisting } from "../src/js/rules/detector.js";

const numericVar = { type: "dataElement", id: "deAge01AAAAA", stageId: "stg01" };

const mockMeta = {
    programRuleVariables: [
        { name: "EIR_AGE", dataElement: { id: "deAge01AAAAA" }, programStage: { id: "stg01" } }
    ],
    programRules: [
        { id: "rule001AAAAA", condition: "d2:hasValue(#{EIR_AGE}) && #{EIR_AGE} > 0",
          programStage: { id: "stg01" } }
    ],
    programRuleActions: [
        { id: "action01AAAA", programRule: { id: "rule001AAAAA" }, programRuleActionType: "SHOWERROR" }
    ]
};

describe("prGetExisting — numeric rules", () => {
    it("detects numeric rule for a dataElement variable", () => {
        const results = prGetExisting(mockMeta, numericVar);
        expect(results.length).toBe(1);
        expect(results[0].rule.id).toBe("rule001AAAAA");
    });
});
