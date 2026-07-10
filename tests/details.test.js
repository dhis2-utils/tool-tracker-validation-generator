import { vi } from "vitest";

vi.mock("../src/js/d2api.js", () => ({
    d2PutJson: vi.fn(),
    d2Delete: vi.fn()
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

import { addValidationCtx, applyQueuedBatchTemplatesCtx, checkFormValidityCtx, collectFormConfigCtx, showBatchApplyPanel } from "../src/js/ui/details.js";
import { d2Delete } from "../src/js/d2api.js";
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

function createRadio(value, checked = false, radios = null, index = null) {
    const radio = createInput("");
    radio.value = value;
    radio.checked = checked;
    radio.disabled = false;
    radio.parentNode = {
        replaceChild: vi.fn((newNode) => {
            newNode.parentNode = radio.parentNode;
            if (radios && index !== null) {
                radios[index] = newNode;
            }
        })
    };
    radio.cloneNode = vi.fn(() => createRadio(radio.value, radio.checked, radios, index));
    return radio;
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
            comparisonDateMode: createInput("variable"),
            comparisonDate: createInput("event_date:event_date_stageA:stageA"),
            fixedComparisonDate: createInput(""),
            relativeComparisonAmount: createInput(""),
            relativeComparisonUnit: createInput("years"),
            relativeComparisonDirection: createInput("past"),
            intervalAmount: createInput("30"),
            intervalUnit: createInput("days")
        });

        const ctx = {
            getCurrent: () => ({ category: "date" })
        };

        expect(collectFormConfigCtx(ctx)).toEqual({
            operator: "within_before",
            comparisonDateMode: "variable",
            comparisonDate: "event_date:event_date_stageA:stageA",
            fixedComparisonDate: "",
            relativeComparisonAmount: null,
            relativeComparisonUnit: "years",
            relativeComparisonDirection: "past",
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

    it("checkFormValidityCtx enables create for a valid date rule", () => {
        global.window = { editingRuleId: null };
        const createValidationBtn = createButton();
        global.document = createDocument({
            createValidationBtn,
            validationPreview: createInput(""),
            validationOperator: createInput("before"),
            comparisonDateMode: createInput("variable"),
            comparisonDate: createInput("enrollment:enrollment_date"),
            fixedComparisonDate: createInput(""),
            relativeComparisonAmount: createInput(""),
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
    });

    it("showBatchApplyPanel renders only unvalidated variables for selected stage scope", () => {
        const batchApplyPanel = { style: { display: "none" } };
        const batchVariableList = createInput("");
        const batchVariableCount = createInput("0");
        const confirmBtn = createButton();
        const cancelBtn = createButton();
        const radios = [];
        const programmeRadio = createRadio("programme", false, radios, 0);
        const stageRadio = createRadio("stage", true, radios, 1);
        radios.push(programmeRadio, stageRadio);

        global.document = createDocument({
            batchApplyPanel,
            batchVariableList,
            batchVariableCount,
            batchApplyConfirmBtn: confirmBtn,
            batchApplyCancelBtn: cancelBtn
        }, radios);

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

    it("showBatchApplyPanel replaces scope radios before rebinding listeners", () => {
        const batchApplyPanel = { style: { display: "none" } };
        const batchVariableList = createInput("");
        const batchVariableCount = createInput("0");
        const confirmBtn = createButton();
        const cancelBtn = createButton();
        const radios = [];
        const programmeRadio = createRadio("programme", true, radios, 0);
        const stageRadio = createRadio("stage", false, radios, 1);
        radios.push(programmeRadio, stageRadio);

        global.document = createDocument({
            batchApplyPanel,
            batchVariableList,
            batchVariableCount,
            batchApplyConfirmBtn: confirmBtn,
            batchApplyCancelBtn: cancelBtn
        }, radios);

        const current = { id: "deCurrent01A", type: "dataElement", stageId: "stageA", category: "numeric", name: "Current" };
        const ctx = {
            getCurrent: () => current,
            getDateVars: () => [current],
            getMeta: () => ({ programRules: [], programRuleActions: [], programRuleVariables: [] })
        };

        showBatchApplyPanel(ctx, { numericOperator: "greater_than" });
        showBatchApplyPanel(ctx, { numericOperator: "greater_than" });

        expect(radios[0].addEventListener).toHaveBeenCalledTimes(1);
        expect(radios[1].addEventListener).toHaveBeenCalledTimes(1);
    });

    it("showBatchApplyPanel restricts programme scope when comparison field is stage-specific", () => {
        const batchApplyPanel = { style: { display: "none" } };
        const batchVariableList = createInput("");
        const batchVariableCount = createInput("0");
        const confirmBtn = createButton();
        const cancelBtn = createButton();
        const radios = [];
        const programmeRadio = createRadio("programme", true, radios, 0);
        const stageRadio = createRadio("stage", false, radios, 1);
        radios.push(programmeRadio, stageRadio);

        global.document = createDocument({
            batchApplyPanel,
            batchVariableList,
            batchVariableCount,
            batchApplyConfirmBtn: confirmBtn,
            batchApplyCancelBtn: cancelBtn
        }, radios);

        const current = { id: "deCurrent01A", type: "dataElement", stageId: "stageA", category: "numeric", name: "Current" };
        const stageATarget = { id: "deFree001AAA", type: "dataElement", stageId: "stageA", category: "numeric", name: "Stage A target" };
        const stageBTarget = { id: "deOther01AAA", type: "dataElement", stageId: "stageB", category: "numeric", name: "Stage B target" };

        const ctx = {
            getCurrent: () => current,
            getDateVars: () => [current, stageATarget, stageBTarget],
            getMeta: () => ({ programRules: [], programRuleActions: [], programRuleVariables: [] }),
            findByComponents: (id, type, stageId) => ({ id, type, stageId, name: "Comparison field" })
        };

        showBatchApplyPanel(ctx, {
            numericOperator: "greater_than",
            numericComparisonType: "field",
            numericComparisonField: "dataElement:cmp001AAAAA:stageA"
        });

        expect(radios[0].disabled).toBe(true);
        expect(radios[1].checked).toBe(true);
        expect(batchVariableCount.textContent).toBe(1);
        expect(batchVariableList.innerHTML).toContain("Stage A target");
        expect(batchVariableList.innerHTML).not.toContain("Stage B target");
    });

    it("batch apply confirm creates tagged rules and refreshes indicators", async () => {
        const elements = {};
        elements.batchApplyPanel = { style: { display: "none" } };
        elements.batchVariableList = createInput("");
        elements.batchVariableCount = createInput("0");
        elements.batchApplyConfirmBtn = createButton("batchApplyConfirmBtn", elements);
        elements.batchApplyCancelBtn = createButton("batchApplyCancelBtn", elements);

        const radios = [];
        const programmeRadio = createRadio("programme", true, radios, 0);
        const stageRadio = createRadio("stage", false, radios, 1);
        radios.push(programmeRadio, stageRadio);

        Object.assign(elements, {
            currentValidations: createInput(""),
            otherProgramRulesCard: { style: { display: "none" } },
            otherProgramRules: createInput(""),
            validationOperator: createInput(""),
            comparisonDateMode: createInput("variable"),
            comparisonDate: createInput(""),
            fixedComparisonDate: createInput(""),
            relativeComparisonAmount: createInput(""),
            relativeComparisonUnit: createInput("years"),
            relativeComparisonDirection: createInput("past"),
            intervalInputs: { style: {} },
            intervalAmount: createInput(""),
            intervalUnit: createInput("days"),
            createValidationBtn: createButton("createValidationBtn", elements),
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
        global.document = createDocument(elements, radios, [checkedBox]);

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

    it("addValidationCtx offers cleanup and deletes existing batch rules after specific create", async () => {
        const elements = {};
        Object.assign(elements, {
            currentValidations: createInput(""),
            otherProgramRulesCard: { style: { display: "none" } },
            otherProgramRules: createInput(""),
            validationOperator: createInput(""),
            comparisonDateMode: createInput("variable"),
            comparisonDate: createInput(""),
            fixedComparisonDate: createInput(""),
            relativeComparisonAmount: createInput(""),
            relativeComparisonUnit: createInput("years"),
            relativeComparisonDirection: createInput("past"),
            intervalInputs: { style: {} },
            intervalAmount: createInput(""),
            intervalUnit: createInput("days"),
            createValidationBtn: createButton("createValidationBtn", elements),
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
        global.document = createDocument(elements);
        global.window = { editingRuleId: null };
        global.confirm = vi.fn(() => true);

        vi.mocked(ensureProgramRuleVariable).mockResolvedValue({ name: "PRV_NUM" });
        vi.mocked(prCreate).mockResolvedValue(undefined);

        let metadata = {
            programRuleVariables: [
                { name: "PRV_NUM", dataElement: { id: "deCurrent01A" }, programStage: { id: "stageA" } }
            ],
            programRules: [
                { id: "Abcdef12345", name: "Generic batch rule", description: "[DVT] [DVT-BATCH] Batch desc", condition: "d2:hasValue(#{PRV_NUM}) && #{PRV_NUM} > 0", programStage: { id: "stageA" } }
            ],
            programRuleActions: [
                { id: "Bcdefg12345", programRule: { id: "Abcdef12345" }, programRuleActionType: "SHOWERROR", dataElement: { id: "deCurrent01A" } }
            ]
        };
        vi.mocked(programGet).mockImplementation(async () => metadata);

        const current = { id: "deCurrent01A", type: "dataElement", stageId: "stageA", category: "numeric", name: "Current" };
        const ctx = {
            getCurrent: () => current,
            getDateVars: () => [current],
            getMeta: () => metadata,
            getProgramId: () => "program12345",
            getConfig: () => ({ programRulePrefix: "PFX", programRuleVariablePrefix: "ABC_" }),
            setMeta: vi.fn((next) => { metadata = next; })
        };

        await addValidationCtx(ctx, {
            numericOperator: "greater_than",
            numericComparisonType: "value",
            numericValue: 0,
            ruleName: "Current > 0",
            ruleDescription: "",
            ruleMessage: "Too low",
            actionType: "SHOWERROR"
        });

        expect(global.confirm).toHaveBeenCalled();
        expect(d2Delete).toHaveBeenCalledWith("/api/programRuleActions/Bcdefg12345");
        expect(d2Delete).toHaveBeenCalledWith("/api/programRules/Abcdef12345");
        expect(showMessage).toHaveBeenCalledWith("Removed 1 batch rule");
    });

    it("applyQueuedBatchTemplatesCtx reports progress while processing queued rules", async () => {
        const elements = {
            currentValidations: createInput(""),
            otherProgramRulesCard: { style: { display: "none" } },
            otherProgramRules: createInput(""),
            validationOperator: createInput(""),
            comparisonDateMode: createInput("variable"),
            comparisonDate: createInput(""),
            fixedComparisonDate: createInput(""),
            relativeComparisonAmount: createInput(""),
            relativeComparisonUnit: createInput("years"),
            relativeComparisonDirection: createInput("past"),
            intervalInputs: { style: {} },
            intervalAmount: createInput(""),
            intervalUnit: createInput("days"),
            createValidationBtn: createButton("createValidationBtn", {}),
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
        };
        global.document = createDocument(elements);
        global.window = { editingRuleId: null };

        vi.mocked(ensureProgramRuleVariable).mockResolvedValue({ name: "PRV_DATE" });
        vi.mocked(prCreate).mockResolvedValue(undefined);
        let metadata = {
            programRules: [],
            programRuleActions: [],
            programRuleVariables: []
        };
        vi.mocked(programGet).mockImplementation(async () => metadata);

        const target = { id: "deFree001AAA", type: "dataElement", stageId: "stageA", stageName: "VISITS", category: "date", name: "Visit date" };
        const ctx = {
            getCurrent: () => target,
            getDateVars: () => [target],
            getMeta: () => metadata,
            getProgramId: () => "program12345",
            getConfig: () => ({ programRulePrefix: "PFX", programRuleVariablePrefix: "ABC_" }),
            setMeta: vi.fn((next) => { metadata = next; })
        };
        const onProgress = vi.fn();

        await applyQueuedBatchTemplatesCtx(ctx, [
            {
                category: "date",
                scope: "stage",
                stageId: "stageA",
                operator: "on_or_after",
                comparisonDateMode: "fixed",
                fixedComparisonDate: "1900-01-01",
                ruleMessage: "Too early"
            },
            {
                category: "date",
                scope: "stage",
                stageId: "stageA",
                operator: "on_or_before",
                comparisonDateMode: "current",
                ruleMessage: "In future"
            }
        ], onProgress);

        expect(onProgress).toHaveBeenCalledWith({ completed: 0, total: 2, currentTemplate: 0 });
        expect(onProgress).toHaveBeenNthCalledWith(2, { completed: 1, total: 2, currentTemplate: 0 });
        expect(onProgress).toHaveBeenNthCalledWith(3, { completed: 2, total: 2, currentTemplate: 1 });
    });

    it("applyQueuedBatchTemplatesCtx applies every queued template to variables that were initially unvalidated", async () => {
        const elements = {
            currentValidations: createInput(""),
            otherProgramRulesCard: { style: { display: "none" } },
            otherProgramRules: createInput(""),
            validationOperator: createInput(""),
            comparisonDateMode: createInput("variable"),
            comparisonDate: createInput(""),
            fixedComparisonDate: createInput(""),
            relativeComparisonAmount: createInput(""),
            relativeComparisonUnit: createInput("years"),
            relativeComparisonDirection: createInput("past"),
            intervalInputs: { style: {} },
            intervalAmount: createInput(""),
            intervalUnit: createInput("days"),
            createValidationBtn: createButton("createValidationBtn", {}),
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
        };
        global.document = createDocument(elements);
        global.window = { editingRuleId: null };

        const target = { id: "deFree001AAA", type: "dataElement", stageId: "stageA", stageName: "VISITS", category: "date", name: "Visit date" };
        vi.mocked(ensureProgramRuleVariable).mockResolvedValue({ name: "PRV_DATE" });
        let metadata = {
            programRules: [],
            programRuleActions: [],
            programRuleVariables: []
        };
        vi.mocked(prCreate).mockImplementation(async (programMetadata, programRule, programRuleActions) => {
            const ruleId = `rule-${programMetadata.programRules.length + 1}`;
            if (!programMetadata.programRuleVariables.some(prv => prv.name === "PRV_DATE")) {
                programMetadata.programRuleVariables.push({
                    id: "prv-1",
                    name: "PRV_DATE",
                    programRuleVariableSourceType: "DATAELEMENT_CURRENT_EVENT",
                    dataElement: { id: target.id }
                });
            }
            programMetadata.programRules.push({ ...programRule, id: ruleId });
            programMetadata.programRuleActions.push(...programRuleActions.map((action, index) => ({
                ...action,
                id: `${ruleId}-action-${index + 1}`,
                programRule: { id: ruleId }
            })));
            return { ...programRule, id: ruleId };
        });
        vi.mocked(programGet).mockImplementation(async () => metadata);

        const ctx = {
            getCurrent: () => target,
            getDateVars: () => [target],
            getMeta: () => metadata,
            getProgramId: () => "program12345",
            getConfig: () => ({ programRulePrefix: "PFX", programRuleVariablePrefix: "ABC_" }),
            setMeta: vi.fn((next) => { metadata = next; })
        };

        await applyQueuedBatchTemplatesCtx(ctx, [
            {
                category: "date",
                scope: "stage",
                stageId: "stageA",
                operator: "on_or_after",
                comparisonDateMode: "fixed",
                fixedComparisonDate: "1900-01-01",
                ruleMessage: "Too early"
            },
            {
                category: "date",
                scope: "stage",
                stageId: "stageA",
                operator: "on_or_before",
                comparisonDateMode: "current",
                ruleMessage: "In future"
            }
        ]);

        expect(prCreate).toHaveBeenCalledTimes(2);
    });
});
