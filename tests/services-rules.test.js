import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("../src/js/d2api.js", () => ({
    d2PostJson: vi.fn(),
    d2Get: vi.fn()
}));

import { d2Get, d2PostJson } from "../src/js/d2api.js";
import { ensureProgramRuleVariable } from "../src/js/services/rules.js";

describe("ensureProgramRuleVariable", () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it("stores a newly created PRV in metadata so later calls reuse it", async () => {
        const metadata = { programRuleVariables: [] };
        const variable = {
            type: "dataElement",
            id: "de123456789",
            name: "HIV positive date",
            valueType: "DATE"
        };

        vi.mocked(d2PostJson).mockResolvedValue({
            id: "prv12345678",
            name: "TRE_HIV_POSITIVE_DATE",
            dataElement: { id: "de123456789" }
        });

        const created = await ensureProgramRuleVariable(metadata, "prog1234567", "TRE", variable, async () => "prv12345678");
        const reused = await ensureProgramRuleVariable(metadata, "prog1234567", "TRE", variable, async () => "prv99999999");

        expect(created.id).toBe("prv12345678");
        expect(reused.id).toBe("prv12345678");
        expect(d2PostJson).toHaveBeenCalledTimes(1);
        expect(metadata.programRuleVariables).toHaveLength(1);
    });

    it("includes stage context in new PRV names for stage data elements", async () => {
        const metadata = { programRuleVariables: [] };
        const variable = {
            type: "dataElement",
            id: "de123456789",
            name: "Date of culture inoculation liquid media",
            stageName: "TB Lab",
            valueType: "DATE"
        };

        vi.mocked(d2PostJson).mockResolvedValue({
            id: "prv12345678",
            name: "TB_CS_TB_LAB_DATE_OF_CULTURE_INOCULATION_LIQUID_MEDIA",
            dataElement: { id: "de123456789" }
        });

        await ensureProgramRuleVariable(metadata, "prog1234567", "TB_CS", variable, async () => "prv12345678");

        expect(d2PostJson).toHaveBeenCalledWith("/api/programRuleVariables", expect.objectContaining({
            name: "TB_CS_TB_LAB_DATE_OF_CULTURE_INOCULATION_LIQUID_MEDIA"
        }));
    });

    it("reuses an existing PRV from the API when create hits a name conflict", async () => {
        const metadata = { programRuleVariables: [] };
        const variable = {
            type: "dataElement",
            id: "de123456789",
            name: "Travel outside country last night",
            stageName: "Diagnosis & Treatment",
            valueType: "DATE"
        };

        vi.mocked(d2PostJson).mockRejectedValue({
            response: {
                responseType: "ObjectReport",
                errorReports: [{ errorCode: "E4051" }]
            }
        });
        vi.mocked(d2Get).mockResolvedValue({
            programRuleVariables: [
                {
                    id: "prvExisting1",
                    name: "MAL_CI_DIAGNOSIS_TREATMENT_TRAVEL_OUTSIDE_COUNTRY_LAST_NIGHT",
                    program: { id: "prog1234567" },
                    programRuleVariableSourceType: "DATAELEMENT_CURRENT_EVENT",
                    dataElement: { id: "de123456789" },
                    valueType: "DATE"
                }
            ]
        });

        const reused = await ensureProgramRuleVariable(metadata, "prog1234567", "MAL_CI", variable, async () => "prv12345678");

        expect(reused.id).toBe("prvExisting1");
        expect(d2Get).toHaveBeenCalledWith("/api/programRuleVariables?filter=program.id:eq:prog1234567&filter=name:eq:MAL_CI_DIAGNOSIS_TREATMENT_TRAVEL_OUTSIDE_COUNTRY_LAST_NIGHT&fields=:owner&paging=false");
        expect(metadata.programRuleVariables).toEqual([expect.objectContaining({ id: "prvExisting1" })]);
    });

    it("retries create with a suffixed PRV name when an exact-name conflict cannot be verified", async () => {
        const metadata = { programRuleVariables: [] };
        const variable = {
            type: "dataElement",
            id: "de999999999",
            name: "When was the most recent IPC assessment",
            stageName: "Healthcare system preparedness",
            valueType: "DATE"
        };

        vi.mocked(d2PostJson)
            .mockRejectedValueOnce({
                response: {
                    response: {
                        responseType: "ObjectReport",
                        errorReports: [{ errorCode: "E4051" }]
                    }
                }
            })
            .mockResolvedValueOnce({
                id: "prvCreated2",
                name: "HFP_HEALTHCARE_SYSTEM_PREPAREDNESS_WHEN_WAS_THE_MOST_RECENT_IPC_ASSESSMENT_DE999999999",
                program: { id: "prog1234567" },
                programRuleVariableSourceType: "DATAELEMENT_CURRENT_EVENT",
                dataElement: { id: "de999999999" },
                valueType: "DATE"
            });
        vi.mocked(d2Get).mockResolvedValue({
            programRuleVariables: [
                {
                    id: "prvExisting2",
                    name: "HFP_HEALTHCARE_SYSTEM_PREPAREDNESS_WHEN_WAS_THE_MOST_RECENT_IPC_ASSESSMENT"
                }
            ]
        });

        const created = await ensureProgramRuleVariable(
            metadata,
            "prog1234567",
            "HFP",
            variable,
            vi.fn()
                .mockResolvedValueOnce("prv12345678")
                .mockResolvedValueOnce("prv23456789")
        );

        expect(created.id).toBe("prvCreated2");
        expect(d2PostJson).toHaveBeenCalledTimes(2);
        expect(d2PostJson).toHaveBeenLastCalledWith("/api/programRuleVariables", expect.objectContaining({
            id: "prv23456789",
            name: "HFP_HEALTHCARE_SYSTEM_PREPAREDNESS_WHEN_WAS_THE_MOST_RECENT_IPC_ASSESSMENT_DE999999999"
        }));
        expect(metadata.programRuleVariables).toEqual([expect.objectContaining({ id: "prvCreated2" })]);
    });
});
