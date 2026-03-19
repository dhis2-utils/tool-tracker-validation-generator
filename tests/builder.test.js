import { generateNewRuleCondition, getVariableReference, isSystemVariable, generateNumericCondition, generateNumericFieldCondition } from "../src/js/rules/builder.js";

const enrollment = { type: "enrollment", id: "enrollment_date" };
const eventDate = { type: "event_date", id: "event_date_stg01", stageId: "stg01" };
const dateDE = { type: "dataElement", id: "deAbc", stageId: "stg01", prvName: "EIR_DE_DATE" };
const dateTEA = { type: "trackedEntityAttribute", id: "teaAbc", prvName: "EIR_TEA_DATE" };

describe("generateNewRuleCondition — null guards", () => {
    it("adds d2:hasValue guard for dataElement variable", () => {
        const condition = generateNewRuleCondition(dateDE, enrollment, { operator: "before" });
        expect(condition).toContain("d2:hasValue(#{EIR_DE_DATE})");
        expect(condition).toContain("d2:daysBetween");
    });

    it("adds d2:hasValue guard for trackedEntityAttribute variable", () => {
        const condition = generateNewRuleCondition(dateTEA, enrollment, { operator: "after" });
        expect(condition).toContain("d2:hasValue(#{EIR_TEA_DATE})");
    });

    it("does NOT add guard for enrollment_date (system variable)", () => {
        const condition = generateNewRuleCondition(enrollment, eventDate, { operator: "before" });
        expect(condition).not.toContain("d2:hasValue");
    });

    it("does NOT add guard for event_date (system variable)", () => {
        const condition = generateNewRuleCondition(eventDate, enrollment, { operator: "after" });
        expect(condition).not.toContain("d2:hasValue");
    });
});

const numDE = { type: "dataElement", id: "deAge01AAAAA", stageId: "stg01", prvName: "EIR_AGE" };
const numDE2 = { type: "dataElement", id: "deWeight01AA", stageId: "stg01", prvName: "EIR_WEIGHT" };

describe("generateNumericCondition — variable vs fixed value", () => {
    it("greater_than produces correct expression", () => {
        const c = generateNumericCondition(numDE, "greater_than", 0);
        expect(c).toBe("d2:hasValue(#{EIR_AGE}) && #{EIR_AGE} > 0");
    });
    it("less_than_or_equal produces correct expression", () => {
        const c = generateNumericCondition(numDE, "less_than_or_equal", 120);
        expect(c).toBe("d2:hasValue(#{EIR_AGE}) && #{EIR_AGE} <= 120");
    });
    it("equal_to produces == expression", () => {
        const c = generateNumericCondition(numDE, "equal_to", 5);
        expect(c).toBe("d2:hasValue(#{EIR_AGE}) && #{EIR_AGE} == 5");
    });
    it("throws on unknown operator", () => {
        expect(() => generateNumericCondition(numDE, "between", 5)).toThrow();
    });
});

describe("generateNumericFieldCondition — variable vs variable", () => {
    it("greater_than produces field comparison", () => {
        const c = generateNumericFieldCondition(numDE, "greater_than", numDE2);
        expect(c).toBe("d2:hasValue(#{EIR_AGE}) && #{EIR_AGE} > #{EIR_WEIGHT}");
    });
});

describe("isSystemVariable", () => {
    it("returns true for enrollment", () => expect(isSystemVariable(enrollment)).toBe(true));
    it("returns true for event_date", () => expect(isSystemVariable(eventDate)).toBe(true));
    it("returns false for dataElement", () => expect(isSystemVariable(dateDE)).toBe(false));
    it("returns false for trackedEntityAttribute", () => expect(isSystemVariable(dateTEA)).toBe(false));
});
