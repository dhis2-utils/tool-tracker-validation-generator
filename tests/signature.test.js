import { parseRuleCondition, isAppGenerated, addAppSignature, isBatchGenerated, addBatchSignature, BATCH_TAG } from "../src/js/rules/signature.js";

const mockMeta = {
    programRuleVariables: [
        {
            name: "EIR_VACCINATION_DATE",
            dataElement: { id: "deVacc01AAAA" },
            programStage: { id: "stage001AAAAA" }
        },
        {
            name: "EIR_DOB",
            trackedEntityAttribute: { id: "teaDob01AAAA" }
        }
    ]
};

const targetVacc = { type: "dataElement", id: "deVacc01AAAA", stageId: "stage001AAAAA" };

describe("parseRuleCondition — date comparisons", () => {
    it("parses before (daysBetween < 0)", () => {
        const result = parseRuleCondition("d2:daysBetween(V{event_date}, V{enrollment_date}) < 0", mockMeta);
        expect(result.config.operator).toBe("before");
    });

    it("parses on_or_after (daysBetween >= 0)", () => {
        const result = parseRuleCondition("d2:daysBetween(V{event_date}, V{enrollment_date}) >= 0", mockMeta);
        expect(result.config.operator).toBe("on_or_after");
    });
});

describe("parseRuleCondition — interval direction", () => {
    it("detects within_after when target is first arg", () => {
        // within_after: d2:*Between(targetRef, compareRef)
        const condition = "d2:daysBetween(#{EIR_VACCINATION_DATE}, V{enrollment_date}) > 30";
        const result = parseRuleCondition(condition, mockMeta, targetVacc);
        expect(result.config.operator).toBe("within_after");
        expect(result.config.intervalAmount).toBe(30);
        expect(result.config.intervalUnit).toBe("days");
    });

    it("detects within_before when target is second arg", () => {
        // within_before: d2:*Between(compareRef, targetRef)
        const condition = "d2:daysBetween(V{enrollment_date}, #{EIR_VACCINATION_DATE}) > 30";
        const result = parseRuleCondition(condition, mockMeta, targetVacc);
        expect(result.config.operator).toBe("within_before");
    });

    it("defaults to within_after when no targetVariable given", () => {
        const condition = "d2:daysBetween(V{enrollment_date}, #{EIR_VACCINATION_DATE}) > 30";
        const result = parseRuleCondition(condition, mockMeta);
        expect(result.config.operator).toBe("within_after");
    });
});

describe("parseRuleCondition — null guards", () => {
    it("parses condition with leading d2:hasValue guard", () => {
        const condition = "d2:hasValue(#{EIR_VACCINATION_DATE}) && d2:daysBetween(#{EIR_VACCINATION_DATE}, V{enrollment_date}) < 0";
        const result = parseRuleCondition(condition, mockMeta);
        expect(result).not.toBeNull();
        expect(result.config.operator).toBe("before");
    });
});

describe("parseRuleCondition — numeric literal", () => {
    it("parses greater_than with fixed value", () => {
        const condition = "d2:hasValue(#{EIR_AGE}) && #{EIR_AGE} > 0";
        // Need mockMeta with EIR_AGE PRV
        const meta = { programRuleVariables: [{ name: "EIR_AGE", dataElement: { id: "deAge01AAAAA" }, programStage: { id: "stg01" } }] };
        const result = parseRuleCondition(condition, meta);
        expect(result).not.toBeNull();
        expect(result.config.operator).toBe("greater_than");
        expect(result.config.comparisonType).toBe("value");
        expect(result.config.value).toBe(0);
        expect(result.variable1.id).toBe("deAge01AAAAA");
    });
});

describe("parseRuleCondition — numeric field-to-field", () => {
    it("parses greater_than between two numeric fields", () => {
        const condition = "d2:hasValue(#{EIR_AGE}) && #{EIR_AGE} > #{EIR_WEIGHT}";
        const meta = {
            programRuleVariables: [
                { name: "EIR_AGE", dataElement: { id: "deAge01AAAAA" }, programStage: { id: "stg01" } },
                { name: "EIR_WEIGHT", dataElement: { id: "deWeight01AA" }, programStage: { id: "stg01" } }
            ]
        };
        const result = parseRuleCondition(condition, meta);
        expect(result).not.toBeNull();
        expect(result.config.operator).toBe("greater_than");
        expect(result.config.comparisonType).toBe("field");
        expect(result.variable2.id).toBe("deWeight01AA");
    });
});

describe("batch signature", () => {
    it("BATCH_TAG is the string DVT-BATCH", () => {
        expect(BATCH_TAG).toBe("DVT-BATCH");
    });

    it("addBatchSignature adds [DVT] and [DVT-BATCH] to description", () => {
        const result = addBatchSignature("My Rule", "Some desc");
        expect(result.description.startsWith("[DVT]")).toBe(true);
        expect(result.description).toContain("[DVT-BATCH]");
    });

    it("addBatchSignature preserves the rule name", () => {
        const result = addBatchSignature("My Rule", "Some desc");
        expect(result.name).toBe("My Rule");
    });

    it("isBatchGenerated returns true for batch-tagged rule", () => {
        const rule = { description: "[DVT] [DVT-BATCH] Some desc" };
        expect(isBatchGenerated(rule)).toBe(true);
    });

    it("isBatchGenerated returns false for app rule without batch tag", () => {
        const rule = { description: "[DVT] Some desc" };
        expect(isBatchGenerated(rule)).toBe(false);
    });
});
