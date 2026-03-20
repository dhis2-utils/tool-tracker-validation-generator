import { vi } from "vitest";

vi.mock("../src/js/d2api.js", () => ({
    d2PutJson: vi.fn()
}));

vi.mock("../src/js/services/rules.js", () => ({
    ensureProgramRuleVariable: vi.fn(),
    prCreate: vi.fn()
}));

vi.mock("../src/js/services/program.js", () => ({
    programGet: vi.fn()
}));

vi.mock("../src/js/variables.js", () => ({
    buildVariablesArray: vi.fn()
}));

vi.mock("../src/js/ui/toast.js", () => ({
    showMessage: vi.fn()
}));

vi.mock("../src/js/ui/overview.js", () => ({
    updateValidationIndicators: vi.fn()
}));

import { checkFormValidityCtx, collectFormConfigCtx, showBatchApplyPanel } from "../src/js/ui/details.js";
import { ensureProgramRuleVariable, prCreate } from "../src/js/services/rules.js";
import { programGet } from "../src/js/services/program.js";
import { showMessage } from "../src/js/ui/toast.js";
import { updateValidationIndicators } from "../src/js/ui/overview.js";

function createInput(value = "") {
    return {
        value,
        style: {},
        disabled: false,
        textContent: "",
        innerHTML: "",
        options: [],
        checked: false,
        addEventListener: vi.fn(),
        appendChild(child) {
            this.options.push(child);
        }
    };
}

function createButton(key = null, elements = null) {
    const button = createInput();
    button.parentNode = {
        replaceChild: vi.fn((newNode) => {
            newNode.parentNode = button.parentNode;
            if (key && elements) {
                elements[key] = newNode;
            }
        })
    };
    button.cloneNode = vi.fn(() => createButton(key, elements));
    return button;
}

function createDocument(elements, radios = [], checkedBoxes = []) {
    return {
        getElementById: (id) => elements[id],
        querySelector: (selector) => {
            if (selector === "input[name='batchScope']:checked") {
                return radios.find(radio => radio.checked) || null;
            }
            return null;
        },
        querySelectorAll: (selector) => {
            if (selector === "input[name='batchScope']") {
                return radios;
            }
            if (selector === ".batch-var-check:checked") {
                return checkedBoxes.filter(box => box.checked);
            }
            if (selector === "#dateVariableDetails select") {
                return [];
            }
            return [];
        },
        createElement: () => ({
            _textContent: "",
            set textContent(value) {
                this._textContent = value;
                this.innerHTML = String(value)
                    .replaceAll("&", "&amp;")
                    .replaceAll("<", "&lt;")
                    .replaceAll(">", "&gt;");
            },
            get textContent() {
                return this._textContent;
            },
            innerHTML: ""
        })
    };
}

describe("details form config and batch panel", () => {
    afterEach(() => {
        delete global.document;
        delete global.window;
        vi.clearAllMocks();
    });

    it("collectFormConfigCtx returns parsed date validation config", () => {
        global.document = createDocument({
            ruleName: createInput("Date rule"),
            ruleDescription: createInput("Desc"),
            ruleMessage: createInput("Message"),
            actionType: createInput("SHOWWARNING"),
            validationOperator: createInput("within_before"),
            comparisonDate: createInput("event_date:event_date_stageA:stageA"),
            intervalAmount: createInput("30"),
            intervalUnit: createInput("days")
        });

        const ctx = {
            getCurrent: () => ({ category: "date" })
        };

        expect(collectFormConfigCtx(ctx)).toEqual({
            operator: "within_before",
            comparisonDate: "event_date:event_date_stageA:stageA",
            intervalAmount: 30,
            intervalUnit: "days",
            ruleName: "Date rule",
            ruleDescription: "Desc",
            ruleMessage: "Message",
            actionType: "SHOWWARNING"
        });
    });

    it("collectFormConfigCtx returns null for invalid numeric value config", () => {
        global.document = createDocument({
            ruleName: createInput("Numeric rule"),
            ruleDescription: createInput(""),
            ruleMessage: createInput("Message"),
            actionType: createInput("SHOWERROR"),
            numericOperator: createInput("greater_than"),
            numericComparisonType: createInput("value"),
            numericValue: createInput(""),
            numericComparisonField: createInput("")
        });

        const ctx = {
            getCurrent: () => ({ category: "numeric" })
        };

        expect(collectFormConfigCtx(ctx)).toBeNull();
    });

    it("checkFormValidityCtx shows batch apply button only for valid create mode", () => {
        global.window = { editingRuleId: null };
        const createValidationBtn = createButton();
        const batchApplyBtn = createButton();
        global.document = createDocument({
            createValidationBtn,
            batchApplyBtn,
            validationPreview: createInput(""),
            validationOperator: createInput("before"),
            comparisonDate: createInput("enrollment:enrollment_date"),
            intervalAmount: createInput(""),
            ruleName: createInput("Date rule"),
            ruleMessage: createInput("Message")
        });

        const ctx = {
            getConfig: () => ({ programRuleVariablePrefix: "ABC_" }),
            getCurrent: () => ({ category: "date" })
        };

        checkFormValidityCtx(ctx);

        expect(createValidationBtn.disabled).toBe(false);
        expect(batchApplyBtn.style.display).toBe("");

        global.window.editingRuleId = "rule001AAAAA";
        checkFormValidityCtx(ctx);

        expect(batchApplyBtn.style.display).toBe("none");
    });

    it("showBatchApplyPanel renders only unvalidated variables for selected stage scope", () => {
        const batchApplyPanel = { style: { display: "none" } };
        const batchVariableList = createInput("");
        const batchVariableCount = createInput("0");
        const confirmBtn = createButton();
        const cancelBtn = createButton();
        const programmeRadio = createInput("");
        programmeRadio.value = "programme";
        const stageRadio = createInput("");
        stageRadio.value = "stage";
        stageRadio.checked = true;

        global.document = createDocument({
            batchApplyPanel,
            batchVariableList,
            batchVariableCount,
            batchApplyConfirmBtn: confirmBtn,
            batchApplyCancelBtn: cancelBtn
        }, [programmeRadio, stageRadio]);

        const current = { id: "deCurrent01A", type: "dataElement", stageId: "stageA", category: "numeric", name: "Current" };
        const unvalidatedSameStage = { id: "deFree001AAA", type: "dataElement", stageId: "stageA", category: "numeric", name: "Valid <Field>" };
        const validatedSameStage = { id: "deTaken01AAA", type: "dataElement", stageId: "stageA", category: "numeric", name: "Taken" };
        const unvalidatedOtherStage = { id: "deOther01AAA", type: "dataElement", stageId: "stageB", category: "numeric", name: "Other stage" };

        const ctx = {
            getCurrent: () => current,
            getDateVars: () => [current, unvalidatedSameStage, validatedSameStage, unvalidatedOtherStage],
            getMeta: () => ({
                programRuleVariables: [
                    { name: "PRV_TAKEN", dataElement: { id: "deTaken01AAA" }, programStage: { id: "stageA" } }
                ],
                programRules: [
                    { id: "rule001AAAAA", condition: "d2:hasValue(#{PRV_TAKEN}) && #{PRV_TAKEN} > 0", programStage: { id: "stageA" } }
                ],
                programRuleActions: [
                    { id: "action01AAAA", programRule: { id: "rule001AAAAA" }, programRuleActionType: "SHOWERROR" }
                ]
            })
        };

        showBatchApplyPanel(ctx, { numericOperator: "greater_than" });

        expect(batchApplyPanel.style.display).toBe("");
        expect(batchVariableCount.textContent).toBe(1);
        expect(batchVariableList.innerHTML).toContain("Valid &lt;Field&gt;");
        expect(batchVariableList.innerHTML).not.toContain("Taken");
        expect(batchVariableList.innerHTML).not.toContain("Other stage");
    });

    it("batch apply confirm creates tagged rules and refreshes indicators", async () => {
        const elements = {};
        elements.batchApplyPanel = { style: { display: "none" } };
        elements.batchVariableList = createInput("");
        elements.batchVariableCount = createInput("0");
        elements.batchApplyConfirmBtn = createButton("batchApplyConfirmBtn", elements);
        elements.batchApplyCancelBtn = createButton("batchApplyCancelBtn", elements);

        const programmeRadio = createInput("");
        programmeRadio.value = "programme";
        programmeRadio.checked = true;
        const stageRadio = createInput("");
        stageRadio.value = "stage";

        Object.assign(elements, {
            currentValidations: createInput(""),
            otherProgramRulesCard: { style: { display: "none" } },
            otherProgramRules: createInput(""),
            validationOperator: createInput(""),
            comparisonDate: createInput(""),
            intervalInputs: { style: {} },
            intervalAmount: createInput(""),
            intervalUnit: createInput("days"),
            createValidationBtn: createButton("createValidationBtn", elements),
            batchApplyBtn: createButton("batchApplyBtn", elements),
            ruleName: createInput(""),
            ruleDescription: createInput(""),
            ruleMessage: createInput(""),
            actionType: createInput("SHOWERROR"),
            dateForm: { style: {} },
            numericForm: { style: {} },
            numericOperator: createInput(""),
            numericComparisonType: createInput("value"),
            numericValue: createInput(""),
            numericComparisonField: createInput(""),
            numericValueInput: { style: {} },
            numericFieldInput: { style: {} },
            validatedDateName: createInput(""),
            validatedNumericName: createInput(""),
            validationPreview: createInput("")
        });

        const checkedBox = { value: "dataElement:deFree001AAA:stageA", checked: true };
        global.document = createDocument(elements, [programmeRadio, stageRadio], [checkedBox]);

        global.window = { editingRuleId: null };

        vi.mocked(ensureProgramRuleVariable)
            .mockResolvedValueOnce({ name: "PRV_FREE" })
            .mockResolvedValueOnce({ name: "PRV_FREE" });
        vi.mocked(prCreate).mockResolvedValue(undefined);
        let metadata = {
            programRules: [],
            programRuleActions: [],
            programRuleVariables: []
        };
        vi.mocked(programGet).mockImplementation(async () => metadata);

        const current = { id: "deCurrent01A", type: "dataElement", stageId: "stageA", category: "numeric", name: "Current" };
        const target = { id: "deFree001AAA", type: "dataElement", stageId: "stageA", category: "numeric", name: "Free" };
        const ctx = {
            getCurrent: () => current,
            getDateVars: () => [current, target],
            getMeta: () => metadata,
            getProgramId: () => "program12345",
            getConfig: () => ({ programRulePrefix: "PFX", programRuleVariablePrefix: "ABC_" }),
            setMeta: vi.fn((next) => { metadata = next; })
        };

        showBatchApplyPanel(ctx, {
            numericOperator: "greater_than",
            numericComparisonType: "value",
            numericValue: 0,
            ruleName: "Free must be > 0",
            ruleDescription: "",
            ruleMessage: "Too low",
            actionType: "SHOWERROR"
        });

        await elements.batchApplyConfirmBtn.addEventListener.mock.calls[0][1]();

        expect(prCreate).toHaveBeenCalledTimes(1);
        expect(showMessage).toHaveBeenCalledWith("Created 1 validation rule successfully");
        expect(updateValidationIndicators).toHaveBeenCalled();
        expect(elements.batchApplyPanel.style.display).toBe("none");
    });
});
