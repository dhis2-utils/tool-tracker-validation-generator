import { describe, expect, it } from 'vitest'
import { parseRuleCondition } from '@/lib/parser'
import type { BatchTemplate, ProgramRuleAction, Variable } from '@/lib/types'
import {
    buildEditConfig,
    buildRelativeDateTarget,
    getConfigErrors,
    isBasicInfoDate,
    createBatchTemplateKey,
    getBatchTemplateSummary,
    getDateComparisonOptions,
    getMissingFieldLabels,
    getSuggestedRuleTexts,
    getUnvalidatedVariables,
    getValidationPreview,
    getVariableDisplayName,
    isConfigComplete,
    resolveDateComparisonTarget,
    ruleRejectsFutureDates,
} from '@/lib/validation'
import { makeMeta, makeRule, makeVariable } from '@/test-utils/helpers'

const enrollment = makeVariable({
    type: 'enrollment',
    id: 'enrollment_date',
    name: 'Enrollment date',
    category: 'date',
})
const dateDE = makeVariable({
    type: 'dataElement',
    id: 'deDate01AAAA',
    name: 'Vaccination date',
    category: 'date',
    stageId: 'stg01',
})
const dateDEOtherStage = makeVariable({
    type: 'dataElement',
    id: 'deDate02AAAA',
    name: 'Follow-up date',
    category: 'date',
    stageId: 'stg02',
})
const numericDE = makeVariable({
    type: 'dataElement',
    id: 'deAge01AAAAA',
    name: 'Age',
    category: 'numeric',
    stageId: 'stg01',
})
const allVariables: Variable[] = [
    enrollment,
    dateDE,
    dateDEOtherStage,
    numericDE,
]

describe('resolveDateComparisonTarget', () => {
    it('resolves fixed dates', () => {
        const target = resolveDateComparisonTarget(
            { comparisonDateMode: 'fixed', fixedComparisonDate: '1900-01-01' },
            allVariables
        )
        expect(target).toEqual(
            expect.objectContaining({ type: 'fixed_date', id: '1900-01-01' })
        )
    })

    it('resolves the current date', () => {
        const target = resolveDateComparisonTarget(
            { comparisonDateMode: 'current' },
            allVariables
        )
        expect(target?.type).toBe('current_date')
    })

    it('resolves relative offsets from the current date', () => {
        const target = resolveDateComparisonTarget(
            {
                comparisonDateMode: 'relative',
                relativeComparisonAmount: 100,
                relativeComparisonUnit: 'years',
                relativeComparisonDirection: 'past',
            },
            allVariables
        )
        expect(target).toEqual(
            expect.objectContaining({
                type: 'relative_current_date',
                relativeAmount: 100,
                relativeUnit: 'years',
                relativeDirection: 'past',
            })
        )
    })

    it('resolves comparison variables by key', () => {
        const target = resolveDateComparisonTarget(
            {
                comparisonDateMode: 'variable',
                comparisonDate: 'dataElement:deDate01AAAA:stg01',
            },
            allVariables
        )
        expect(target).toBe(dateDE)
    })

    it('returns null for an incomplete fixed config', () => {
        expect(
            resolveDateComparisonTarget(
                { comparisonDateMode: 'fixed' },
                allVariables
            )
        ).toBe(null)
    })
})

describe('buildRelativeDateTarget', () => {
    it('returns null for zero or invalid amounts', () => {
        expect(buildRelativeDateTarget(0, 'years', 'past')).toBeNull()
        expect(buildRelativeDateTarget('', 'years', 'past')).toBeNull()
    })
})

describe('getUnvalidatedVariables', () => {
    const metaWithRule = makeMeta({
        programRuleVariables: [
            {
                id: 'prv01AAAAAA',
                name: 'PRV_VACC',
                dataElement: { id: 'deDate01AAAA' },
                programStage: { id: 'stg01' },
                programRuleVariableSourceType: 'DATAELEMENT_CURRENT_EVENT',
            },
        ],
        programRules: [
            makeRule({
                id: 'rule01AAAAA',
                programStage: { id: 'stg01' },
                condition:
                    'd2:hasValue(#{PRV_VACC}) && d2:hasValue(V{enrollment_date}) && d2:daysBetween(#{PRV_VACC}, V{enrollment_date}) < 0',
            }),
        ],
        programRuleActions: [
            {
                id: 'act01AAAAAA',
                programRule: { id: 'rule01AAAAA' },
                programRuleActionType: 'SHOWERROR',
            },
        ],
    })

    it('excludes variables that already have rules', () => {
        const result = getUnvalidatedVariables(
            metaWithRule,
            allVariables,
            'date',
            null
        )
        expect(result).not.toContain(dateDE)
        expect(result).toContain(enrollment)
        expect(result).toContain(dateDEOtherStage)
    })

    it('filters by category', () => {
        const result = getUnvalidatedVariables(
            metaWithRule,
            allVariables,
            'numeric',
            null
        )
        expect(result).toEqual([numericDE])
    })

    it('filters by stage when a stageId is given', () => {
        const result = getUnvalidatedVariables(
            metaWithRule,
            allVariables,
            'date',
            'stg02'
        )
        expect(result).toEqual([dateDEOtherStage])
    })

    it('excludes the given variable', () => {
        const result = getUnvalidatedVariables(
            makeMeta(),
            allVariables,
            'date',
            null,
            dateDEOtherStage
        )
        expect(result).not.toContain(dateDEOtherStage)
    })

    it('never offers due dates: they are expected to be in the future', () => {
        const due = makeVariable({
            type: 'due_date',
            id: 'due_date_stg01',
            category: 'date',
            stageId: 'stg01',
        })
        expect(
            getUnvalidatedVariables(
                makeMeta(),
                [...allVariables, due],
                'date',
                null
            )
        ).not.toContain(due)
        expect(
            getUnvalidatedVariables(
                makeMeta(),
                [...allVariables, due],
                'date',
                'stg01'
            )
        ).not.toContain(due)
    })
})

describe('getDateComparisonOptions', () => {
    it('offers enrollment-level dates and same-stage data elements for a stage DE', () => {
        const options = getDateComparisonOptions(dateDE, allVariables)
        expect(options).toContain(enrollment)
        expect(options).not.toContain(dateDEOtherStage) // different stage
        expect(options).not.toContain(numericDE) // numeric
        expect(options).not.toContain(dateDE) // itself
    })
})

describe('getMissingFieldLabels', () => {
    const base = { ruleName: 'Rule', ruleMessage: 'Message' }

    it('flags a relative comparison with no offset amount', () => {
        // The reported bug: editing a rule into "relative to current date"
        // but leaving the offset blank left Save silently disabled.
        expect(
            getMissingFieldLabels(enrollment, {
                ...base,
                operator: 'after',
                comparisonDateMode: 'relative',
                relativeComparisonAmount: null,
                relativeComparisonUnit: 'years',
                relativeComparisonDirection: 'past',
            })
        ).toEqual(['Offset amount'])
    })

    it('returns an empty array for a complete config', () => {
        expect(
            getMissingFieldLabels(enrollment, {
                ...base,
                operator: 'after',
                comparisonDateMode: 'relative',
                relativeComparisonAmount: 1,
            })
        ).toEqual([])
    })

    it('flags missing rule name and message', () => {
        const missing = getMissingFieldLabels(enrollment, {
            operator: 'after',
            comparisonDateMode: 'current',
        })
        expect(missing).toContain('Rule name')
        expect(missing).toContain('Validation message')
    })

    it('stays consistent with isConfigComplete', () => {
        const incomplete = {
            ...base,
            operator: 'after',
            comparisonDateMode: 'relative' as const,
            relativeComparisonAmount: null,
        }
        expect(getMissingFieldLabels(enrollment, incomplete).length > 0).toBe(
            !isConfigComplete(enrollment, incomplete)
        )
    })
})

describe('isConfigComplete', () => {
    const base = { ruleName: 'Rule', ruleMessage: 'Message' }

    it('requires a comparison target matching the mode', () => {
        expect(
            isConfigComplete(dateDE, {
                ...base,
                operator: 'before',
                comparisonDateMode: 'variable',
            })
        ).toBe(false)
        expect(
            isConfigComplete(dateDE, {
                ...base,
                operator: 'before',
                comparisonDateMode: 'current',
            })
        ).toBe(true)
    })

    it('requires interval amount for within operators', () => {
        const config = {
            ...base,
            operator: 'within_before',
            comparisonDateMode: 'current' as const,
        }
        expect(isConfigComplete(dateDE, config)).toBe(false)
        expect(
            isConfigComplete(dateDE, { ...config, intervalAmount: 30 })
        ).toBe(true)
    })

    it('requires value or field for numeric validations', () => {
        expect(
            isConfigComplete(numericDE, {
                ...base,
                numericOperator: 'greater_than',
                numericComparisonType: 'value',
            })
        ).toBe(false)
        expect(
            isConfigComplete(numericDE, {
                ...base,
                numericOperator: 'greater_than',
                numericComparisonType: 'value',
                numericValue: 0,
            })
        ).toBe(true)
        expect(
            isConfigComplete(numericDE, {
                ...base,
                numericOperator: 'greater_than',
                numericComparisonType: 'field',
                numericComparisonField: 'dataElement:deAge01AAAAA:stg01',
            })
        ).toBe(true)
    })
})

describe('getValidationPreview', () => {
    it('previews date validations with suggestions', () => {
        const texts = getValidationPreview(
            dateDE,
            { operator: 'before', comparisonDateMode: 'current' },
            allVariables
        )
        expect(texts.preview).toBe(
            'Vaccination date should be before Current date'
        )
        expect(texts.suggestedRuleName).toBe(
            'Vaccination date must be before Current date'
        )
        expect(texts.suggestedDescription).toContain(
            'Validates that Vaccination date'
        )
    })

    it('previews numeric validations against fixed values', () => {
        const texts = getValidationPreview(
            numericDE,
            {
                numericOperator: 'greater_than',
                numericComparisonType: 'value',
                numericValue: 0,
            },
            allVariables
        )
        expect(texts.preview).toBe('Age should be greater than 0')
    })

    it('returns empty preview for incomplete configs', () => {
        const texts = getValidationPreview(
            dateDE,
            { operator: 'before' },
            allVariables
        )
        expect(texts.preview).toBe('')
    })
})

describe('buildEditConfig', () => {
    const meta = makeMeta({
        programRuleVariables: [
            {
                id: 'prv01AAAAAA',
                name: 'PRV_VACC',
                dataElement: { id: 'deDate01AAAA' },
                programStage: { id: 'stg01' },
                programRuleVariableSourceType: 'DATAELEMENT_CURRENT_EVENT',
            },
        ],
    })
    const action: ProgramRuleAction = {
        id: 'act01AAAAAA',
        programRule: { id: 'rule01AAAAA' },
        programRuleActionType: 'SHOWWARNING',
        content: 'The message',
    }

    it('maps a fixed-date rule back to form config and strips the name prefix', () => {
        const rule = makeRule({
            name: 'EIR - Vaccination rule',
            description: '[DVT] Some description',
            condition:
                "d2:hasValue(#{PRV_VACC}) && d2:daysBetween(#{PRV_VACC}, '1900-01-01') >= 0",
        })
        const parsed = parseRuleCondition(rule.condition, meta, 'stg01')
        const config = buildEditConfig(
            parsed!,
            rule,
            action,
            dateDE,
            allVariables,
            'EIR'
        )
        expect(config.ruleName).toBe('Vaccination rule')
        expect(config.ruleDescription).toBe('Some description')
        expect(config.ruleMessage).toBe('The message')
        expect(config.actionType).toBe('SHOWWARNING')
        expect(config.comparisonDateMode).toBe('fixed')
        expect(config.fixedComparisonDate).toBe('1900-01-01')
        expect(config.operator).toBe('after')
    })

    it('maps a relative-date rule back to form config', () => {
        const rule = makeRule({
            condition:
                'd2:hasValue(#{PRV_VACC}) && d2:daysBetween(#{PRV_VACC}, d2:addDays(V{current_date}, -100)) >= 0',
        })
        const parsed = parseRuleCondition(rule.condition, meta, 'stg01')
        const config = buildEditConfig(
            parsed!,
            rule,
            action,
            dateDE,
            allVariables
        )
        expect(config.comparisonDateMode).toBe('relative')
        expect(config.relativeComparisonAmount).toBe(100)
        expect(config.relativeComparisonUnit).toBe('days')
        expect(config.relativeComparisonDirection).toBe('past')
    })

    it('maps a variable comparison back to a comparison key', () => {
        const rule = makeRule({
            condition:
                'd2:hasValue(#{PRV_VACC}) && d2:hasValue(V{enrollment_date}) && d2:daysBetween(#{PRV_VACC}, V{enrollment_date}) <= 0',
        })
        const parsed = parseRuleCondition(rule.condition, meta, 'stg01')
        const config = buildEditConfig(
            parsed!,
            rule,
            action,
            dateDE,
            allVariables
        )
        expect(config.comparisonDateMode).toBe('variable')
        expect(config.comparisonDate).toBe('enrollment:enrollment_date')
        expect(config.operator).toBe('before')
    })

    it('maps numeric literal rules to numeric form config', () => {
        const numericMeta = makeMeta({
            programRuleVariables: [
                {
                    id: 'prvAge01AAA',
                    name: 'PRV_AGE',
                    dataElement: { id: 'deAge01AAAAA' },
                    programStage: { id: 'stg01' },
                    programRuleVariableSourceType: 'DATAELEMENT_CURRENT_EVENT',
                },
            ],
        })
        // Stored condition holds the VIOLATION op: "<= 120" round-trips to the
        // constraint "greater_than 120".
        const rule = makeRule({
            condition: 'd2:hasValue(#{PRV_AGE}) && #{PRV_AGE} <= 120',
        })
        const parsed = parseRuleCondition(rule.condition, numericMeta, 'stg01')
        const config = buildEditConfig(
            parsed!,
            rule,
            action,
            numericDE,
            allVariables
        )
        expect(config.numericOperator).toBe('greater_than')
        expect(config.numericComparisonType).toBe('value')
        expect(config.numericValue).toBe(120)
    })

    it('round-trips a numeric between into min/max form config', () => {
        const numericMeta = makeMeta({
            programRuleVariables: [
                {
                    id: 'prvAge01AAA',
                    name: 'PRV_AGE',
                    dataElement: { id: 'deAge01AAAAA' },
                    programStage: { id: 'stg01' },
                    programRuleVariableSourceType: 'DATAELEMENT_CURRENT_EVENT',
                },
            ],
        })
        const rule = makeRule({
            condition:
                'd2:hasValue(#{PRV_AGE}) && (#{PRV_AGE} < 0 || #{PRV_AGE} > 115)',
        })
        const parsed = parseRuleCondition(rule.condition, numericMeta, 'stg01')
        const config = buildEditConfig(
            parsed!,
            rule,
            action,
            numericDE,
            allVariables
        )
        expect(config.numericOperator).toBe('between')
        expect(config.numericValue).toBe(0)
        expect(config.numericValueMax).toBe(115)
    })

    it('round-trips a date between into lower and upper bound config', () => {
        const rule = makeRule({
            condition:
                "d2:hasValue(#{PRV_VACC}) && (d2:daysBetween(#{PRV_VACC}, '2000-01-01') > 0 || " +
                'd2:daysBetween(#{PRV_VACC}, V{current_date}) < 0)',
        })
        const parsed = parseRuleCondition(rule.condition, meta, 'stg01')
        const config = buildEditConfig(
            parsed!,
            rule,
            action,
            dateDE,
            allVariables
        )
        expect(config.operator).toBe('between')
        expect(config.comparisonDateMode).toBe('fixed')
        expect(config.fixedComparisonDate).toBe('2000-01-01')
        expect(config.upperComparisonDateMode).toBe('current')
    })

    it('nulls out texts that still match the generated default', () => {
        // Stored texts equal exactly what the generator would produce for
        // this "after 1900-01-01" rule, so they should be treated as default.
        const rule = makeRule({
            name: 'Vaccination date must be after 1900-01-01',
            description:
                '[DVT] Validates that Vaccination date is after 1900-01-01',
            condition:
                "d2:hasValue(#{PRV_VACC}) && d2:daysBetween(#{PRV_VACC}, '1900-01-01') >= 0",
        })
        const defaultAction: ProgramRuleAction = {
            ...action,
            content: 'Must be after 1900-01-01',
        }
        const parsed = parseRuleCondition(rule.condition, meta, 'stg01')
        const config = buildEditConfig(
            parsed!,
            rule,
            defaultAction,
            dateDE,
            allVariables
        )
        expect(config.ruleName).toBeUndefined()
        expect(config.ruleDescription).toBeUndefined()
        expect(config.ruleMessage).toBeUndefined()
    })

    it('nulls out texts on a BULK rule whose description carries both the app and batch tags', () => {
        // Bulk/batch rules are tagged "[DVT] [DVT-BATCH] ...". Stripping only
        // the app tag would leave "[DVT-BATCH] Validates that ..." dangling,
        // which would never match the generated default.
        const rule = makeRule({
            name: 'Vaccination date must be after 1900-01-01',
            description:
                '[DVT] [DVT-BATCH] Validates that Vaccination date is after 1900-01-01',
            condition:
                "d2:hasValue(#{PRV_VACC}) && d2:daysBetween(#{PRV_VACC}, '1900-01-01') >= 0",
        })
        const defaultAction: ProgramRuleAction = {
            ...action,
            content: 'Must be after 1900-01-01',
        }
        const parsed = parseRuleCondition(rule.condition, meta, 'stg01')
        const config = buildEditConfig(
            parsed!,
            rule,
            defaultAction,
            dateDE,
            allVariables
        )
        expect(config.ruleName).toBeUndefined()
        expect(config.ruleDescription).toBeUndefined()
        expect(config.ruleMessage).toBeUndefined()
    })

    it("judges the stored message against the rule's own action type", () => {
        // The default message depends on the action type: on-complete rules
        // carry the field name, inline ones do not. Judging an on-complete
        // rule against the inline default would mark an untouched message as
        // customized and stop it re-syncing.
        const rule = makeRule({
            name: 'Vaccination date must be after 1900-01-01',
            description:
                '[DVT] Validates that Vaccination date is after 1900-01-01',
            condition:
                "d2:hasValue(#{PRV_VACC}) && d2:daysBetween(#{PRV_VACC}, '1900-01-01') >= 0",
        })
        const onCompleteAction: ProgramRuleAction = {
            ...action,
            programRuleActionType: 'ERRORONCOMPLETE',
            content: 'Vaccination date must be after 1900-01-01',
        }
        const parsed = parseRuleCondition(rule.condition, meta, 'stg01')
        const config = buildEditConfig(
            parsed!,
            rule,
            onCompleteAction,
            dateDE,
            allVariables
        )
        expect(config.actionType).toBe('ERRORONCOMPLETE')
        expect(config.ruleMessage).toBeUndefined()
    })

    it('treats the inline default as customized on an on-complete rule', () => {
        // Mirror of the test above: the field-less text is the default only
        // for SHOWERROR/SHOWWARNING, so on an on-complete rule it is a real
        // customization and must be preserved.
        const rule = makeRule({
            name: 'Vaccination date must be after 1900-01-01',
            condition:
                "d2:hasValue(#{PRV_VACC}) && d2:daysBetween(#{PRV_VACC}, '1900-01-01') >= 0",
        })
        const onCompleteAction: ProgramRuleAction = {
            ...action,
            programRuleActionType: 'WARNINGONCOMPLETE',
            content: 'Must be after 1900-01-01',
        }
        const parsed = parseRuleCondition(rule.condition, meta, 'stg01')
        const config = buildEditConfig(
            parsed!,
            rule,
            onCompleteAction,
            dateDE,
            allVariables
        )
        expect(config.ruleMessage).toBe('Must be after 1900-01-01')
    })

    it('keeps texts that were customized away from the default', () => {
        const rule = makeRule({
            name: 'Vaccination date must be after 1900-01-01',
            description: '[DVT] A custom description',
            condition:
                "d2:hasValue(#{PRV_VACC}) && d2:daysBetween(#{PRV_VACC}, '1900-01-01') >= 0",
        })
        const mixedAction: ProgramRuleAction = {
            ...action,
            content: 'A custom message',
        }
        const parsed = parseRuleCondition(rule.condition, meta, 'stg01')
        const config = buildEditConfig(
            parsed!,
            rule,
            mixedAction,
            dateDE,
            allVariables
        )
        // Name matches the default → nulled; description/message customized → kept.
        expect(config.ruleName).toBeUndefined()
        expect(config.ruleDescription).toBe('A custom description')
        expect(config.ruleMessage).toBe('A custom message')
    })
})

describe('between — preview and completeness', () => {
    it('previews a numeric between', () => {
        const preview = getValidationPreview(
            numericDE,
            {
                numericOperator: 'between',
                numericValue: 0,
                numericValueMax: 115,
            },
            allVariables
        )
        expect(preview.preview).toBe(
            'Age should be between 0 and 115 (inclusive)'
        )
    })

    it('previews a date between with both bounds', () => {
        const preview = getValidationPreview(
            enrollment,
            {
                operator: 'between',
                comparisonDateMode: 'relative',
                relativeComparisonAmount: 1,
                relativeComparisonUnit: 'years',
                relativeComparisonDirection: 'past',
                upperComparisonDateMode: 'current',
            },
            allVariables
        )
        expect(preview.preview).toBe(
            'Enrollment date should be between 1 year before current date and Current date (inclusive)'
        )
    })

    it('flags a numeric between missing its maximum', () => {
        const missing = getMissingFieldLabels(numericDE, {
            ruleName: 'R',
            ruleMessage: 'M',
            numericOperator: 'between',
            numericValue: 0,
        })
        expect(missing).toEqual(['Maximum value'])
    })

    it('flags a date between missing its upper bound', () => {
        const missing = getMissingFieldLabels(enrollment, {
            ruleName: 'R',
            ruleMessage: 'M',
            operator: 'between',
            comparisonDateMode: 'current',
            upperComparisonDateMode: 'variable',
        })
        expect(missing).toEqual(['Upper comparison date field'])
    })
})

describe('ruleRejectsFutureDates', () => {
    it('is true for before/on-or-before the current date', () => {
        expect(
            ruleRejectsFutureDates({
                operator: 'before',
                comparisonDateMode: 'current',
            })
        ).toBe(true)
        expect(
            ruleRejectsFutureDates({
                operator: 'on_or_before',
                comparisonDateMode: 'current',
            })
        ).toBe(true)
    })

    it('is true for between … and the current date (upper bound)', () => {
        expect(
            ruleRejectsFutureDates({
                operator: 'between',
                comparisonDateMode: 'fixed',
                fixedComparisonDate: '2000-01-01',
                upperComparisonDateMode: 'current',
            })
        ).toBe(true)
    })

    it('is false for rules that do not reject future dates', () => {
        expect(
            ruleRejectsFutureDates({
                operator: 'after',
                comparisonDateMode: 'current',
            })
        ).toBe(false)
        expect(
            ruleRejectsFutureDates({
                operator: 'before',
                comparisonDateMode: 'fixed',
                fixedComparisonDate: '2000-01-01',
            })
        ).toBe(false)
    })
})

describe('batch templates', () => {
    const template: BatchTemplate = {
        category: 'date',
        scope: 'programme',
        actionType: 'SHOWERROR',
        operator: 'before',
        comparisonDateMode: 'current',
    }

    it('summarises date templates', () => {
        expect(getBatchTemplateSummary(template)).toBe(
            'Any unvalidated date should be before current date'
        )
    })

    it('summarises a date between template with both bounds', () => {
        expect(
            getBatchTemplateSummary({
                ...template,
                operator: 'between',
                comparisonDateMode: 'fixed',
                fixedComparisonDate: '2000-01-01',
                upperComparisonDateMode: 'current',
            })
        ).toBe(
            'Any unvalidated date should be between 2000-01-01 and current date (inclusive)'
        )
    })

    it('summarises a numeric between template with min and max', () => {
        expect(
            getBatchTemplateSummary({
                category: 'numeric',
                scope: 'programme',
                actionType: 'SHOWERROR',
                numericOperator: 'between',
                numericValue: 0,
                numericValueMax: 115,
            })
        ).toBe(
            'Any unvalidated numeric variable should be between 0 and 115 (inclusive)'
        )
    })

    it('summarises interval templates with direction', () => {
        expect(
            getBatchTemplateSummary({
                ...template,
                operator: 'within_before',
                intervalAmount: 30,
                intervalUnit: 'days',
            })
        ).toBe(
            'Any unvalidated date should be within 30 days before current date'
        )
    })

    it('summarises numeric templates', () => {
        expect(
            getBatchTemplateSummary({
                category: 'numeric',
                scope: 'programme',
                actionType: 'SHOWERROR',
                numericOperator: 'greater_than_or_equal',
                numericValue: 0,
            })
        ).toBe(
            'Any unvalidated numeric variable should be greater than or equal to 0'
        )
    })

    it('creates identical keys for identical templates', () => {
        expect(createBatchTemplateKey(template)).toBe(
            createBatchTemplateKey({ ...template })
        )
        expect(createBatchTemplateKey(template)).not.toBe(
            createBatchTemplateKey({ ...template, operator: 'after' })
        )
    })
})

describe('getUnvalidatedVariables — pseudo-variables', () => {
    it('never targets the synthetic current-date variable', () => {
        const currentDate = makeVariable({
            type: 'current_date',
            id: 'current_date',
            name: 'Current date',
            category: 'date',
        })
        const result = getUnvalidatedVariables(
            makeMeta(),
            [currentDate, enrollment],
            'date',
            null
        )
        expect(result).toEqual([enrollment])
    })
})

describe('getSuggestedRuleTexts', () => {
    it('projects the three suggested texts for a date rule', () => {
        const texts = getSuggestedRuleTexts(
            dateDE,
            {
                operator: 'after',
                comparisonDateMode: 'fixed',
                fixedComparisonDate: '1900-01-01',
            },
            allVariables
        )
        expect(texts.name).toBe('Vaccination date must be after 1900-01-01')
        expect(texts.message).toBe('Must be after 1900-01-01')
        expect(texts.description).toBe(
            'Validates that Vaccination date is after 1900-01-01'
        )
    })

    it('gives a numeric "between" name that carries both bounds', () => {
        const texts = getSuggestedRuleTexts(
            numericDE,
            {
                numericOperator: 'between',
                numericValue: 0,
                numericValueMax: 115,
            },
            allVariables
        )
        expect(texts.name).toBe('Age must be between 0 and 115 (inclusive)')
    })

    // Stage context and the message's field name are covered in detail by the
    // "default-text templates" suite below.
})

describe('getVariableDisplayName', () => {
    const stageBound = makeVariable({
        type: 'dataElement',
        name: 'Vacc date',
        stageId: 'stgA',
        stageName: 'Stage A',
    })

    it('appends stage name for stage-bound data elements', () => {
        expect(getVariableDisplayName(stageBound)).toBe('Vacc date (Stage A)')
    })

    it('returns the raw name when there is no stage name', () => {
        expect(
            getVariableDisplayName(
                makeVariable({ type: 'enrollment', name: 'Enrollment date' })
            )
        ).toBe('Enrollment date')
    })

    it('omits the stage name when the programme has a single stage', () => {
        expect(getVariableDisplayName(stageBound, 1)).toBe('Vacc date')
    })

    it('keeps the stage name when the programme has several stages', () => {
        expect(getVariableDisplayName(stageBound, 3)).toBe(
            'Vacc date (Stage A)'
        )
    })

    describe('variables whose name carries a synthetic type marker', () => {
        const eventDate = makeVariable({
            type: 'event_date',
            id: 'event_date_stgA',
            name: 'Report date (event date)',
            typeLabel: 'event date',
            stageId: 'stgA',
            stageName: 'Specimen Tracking',
        })

        it('folds the stage into the type marker instead of adding a second parenthetical', () => {
            expect(getVariableDisplayName(eventDate, 2)).toBe(
                'Report date (Specimen Tracking event date)'
            )
        })

        it('leaves the type marker alone when the programme has a single stage', () => {
            expect(getVariableDisplayName(eventDate, 1)).toBe(
                'Report date (event date)'
            )
        })

        it('appends the stage normally when there is no type marker', () => {
            expect(
                getVariableDisplayName(
                    makeVariable({
                        type: 'due_date',
                        name: 'Due date',
                        stageId: 'stgA',
                        stageName: 'Specimen Tracking',
                    }),
                    2
                )
            ).toBe('Due date (Specimen Tracking)')
        })

        it('does not mistake a real parenthetical in a data element name for a type marker', () => {
            expect(
                getVariableDisplayName(
                    makeVariable({
                        type: 'dataElement',
                        name: 'Weight (kg)',
                        stageId: 'stgA',
                        stageName: 'Specimen Tracking',
                    }),
                    2
                )
            ).toBe('Weight (kg) (Specimen Tracking)')
        })
    })
})

describe('default-text templates', () => {
    const stageA = makeVariable({
        type: 'dataElement',
        id: 'deStageAAAA',
        name: 'Vacc date',
        category: 'date',
        stageId: 'stgA',
        stageName: 'Stage A',
    })
    const stageB = makeVariable({
        type: 'dataElement',
        id: 'deStageBBBB',
        name: 'Other date',
        category: 'date',
        stageId: 'stgB',
        stageName: 'Stage B',
    })
    const multiStage = [stageA, stageB]
    const singleStage = [stageA]
    const before = {
        operator: 'before',
        comparisonDateMode: 'current',
    } as const

    describe('rule name', () => {
        it('says "must be" on the interval variant', () => {
            const texts = getSuggestedRuleTexts(
                stageA,
                {
                    operator: 'within_after',
                    comparisonDateMode: 'current',
                    intervalAmount: 30,
                    intervalUnit: 'days',
                },
                multiStage
            )
            expect(texts.name).toBe(
                'Vacc date (Stage A) must be within 30 days after Current date'
            )
        })

        it('keeps the stage suffix when the programme has several stages', () => {
            const texts = getSuggestedRuleTexts(stageA, before, multiStage)
            expect(texts.name).toBe(
                'Vacc date (Stage A) must be before Current date'
            )
        })

        it('drops the stage suffix when the programme has a single stage', () => {
            const texts = getSuggestedRuleTexts(stageA, before, singleStage)
            expect(texts.name).toBe('Vacc date must be before Current date')
        })
    })

    describe('description', () => {
        it('spells out the stage when the programme has several stages', () => {
            const texts = getSuggestedRuleTexts(stageA, before, multiStage)
            expect(texts.description).toBe(
                'Validates that Vacc date in the Stage A stage is before Current date'
            )
        })

        it('omits the stage clause when the programme has a single stage', () => {
            const texts = getSuggestedRuleTexts(stageA, before, singleStage)
            expect(texts.description).toBe(
                'Validates that Vacc date is before Current date'
            )
        })

        it('omits the stage clause for a variable that has no stage', () => {
            const texts = getSuggestedRuleTexts(enrollment, before, [
                enrollment,
                ...multiStage,
            ])
            expect(texts.description).toBe(
                'Validates that Enrollment date is before Current date'
            )
        })

        it('says "is after", not "is entered after"', () => {
            const texts = getSuggestedRuleTexts(
                stageA,
                {
                    operator: 'after',
                    comparisonDateMode: 'fixed',
                    fixedComparisonDate: '2000-01-01',
                },
                singleStage
            )
            expect(texts.description).toBe(
                'Validates that Vacc date is after 2000-01-01'
            )
        })

        it('marks a date "between" inclusive the same way the name does', () => {
            const texts = getSuggestedRuleTexts(
                stageA,
                {
                    operator: 'between',
                    comparisonDateMode: 'fixed',
                    fixedComparisonDate: '2000-01-01',
                    upperComparisonDateMode: 'fixed',
                    upperFixedComparisonDate: '2020-01-01',
                },
                singleStage
            )
            expect(texts.description).toBe(
                'Validates that Vacc date is between 2000-01-01 and 2020-01-01 (inclusive)'
            )
        })

        it('marks a numeric "between" inclusive too', () => {
            const texts = getSuggestedRuleTexts(
                numericDE,
                {
                    numericOperator: 'between',
                    numericValue: 0,
                    numericValueMax: 115,
                },
                allVariables
            )
            expect(texts.description).toBe(
                'Validates that Age is between 0 and 115 (inclusive)'
            )
        })
    })

    describe('validation message', () => {
        it('omits the field name for SHOWERROR, which renders next to the field', () => {
            const texts = getSuggestedRuleTexts(
                stageA,
                { ...before, actionType: 'SHOWERROR' },
                multiStage
            )
            expect(texts.message).toBe('Must be before Current date')
        })

        it('omits the field name for SHOWWARNING', () => {
            const texts = getSuggestedRuleTexts(
                stageA,
                { ...before, actionType: 'SHOWWARNING' },
                multiStage
            )
            expect(texts.message).toBe('Must be before Current date')
        })

        it('omits the field name when no action type is set, since SHOWERROR is the default', () => {
            const texts = getSuggestedRuleTexts(stageA, before, multiStage)
            expect(texts.message).toBe('Must be before Current date')
        })

        it('keeps the field name for ERRORONCOMPLETE, which renders in a modal', () => {
            const texts = getSuggestedRuleTexts(
                stageA,
                { ...before, actionType: 'ERRORONCOMPLETE' },
                multiStage
            )
            expect(texts.message).toBe('Vacc date must be before Current date')
        })

        it('keeps the field name for WARNINGONCOMPLETE', () => {
            const texts = getSuggestedRuleTexts(
                stageA,
                { ...before, actionType: 'WARNINGONCOMPLETE' },
                multiStage
            )
            expect(texts.message).toBe('Vacc date must be before Current date')
        })

        it('never carries the stage suffix, even on a multi-stage programme', () => {
            const texts = getSuggestedRuleTexts(
                stageA,
                { ...before, actionType: 'ERRORONCOMPLETE' },
                multiStage
            )
            expect(texts.message).not.toContain('Stage A')
        })

        it('capitalises the field-less form for a numeric rule', () => {
            const texts = getSuggestedRuleTexts(
                numericDE,
                {
                    numericOperator: 'greater_than',
                    numericComparisonType: 'value',
                    numericValue: 0,
                    actionType: 'SHOWERROR',
                },
                allVariables
            )
            expect(texts.message).toBe('Must be greater than 0')
        })

        it('capitalises the field-less form for an interval rule', () => {
            const texts = getSuggestedRuleTexts(
                stageA,
                {
                    operator: 'within_after',
                    comparisonDateMode: 'current',
                    intervalAmount: 30,
                    intervalUnit: 'days',
                    actionType: 'SHOWERROR',
                },
                singleStage
            )
            expect(texts.message).toBe(
                'Must be within 30 days after Current date'
            )
        })

        it('capitalises the field-less form for a between rule', () => {
            const texts = getSuggestedRuleTexts(
                stageA,
                {
                    operator: 'between',
                    comparisonDateMode: 'fixed',
                    fixedComparisonDate: '2000-01-01',
                    upperComparisonDateMode: 'fixed',
                    upperFixedComparisonDate: '2020-01-01',
                    actionType: 'SHOWERROR',
                },
                singleStage
            )
            expect(texts.message).toBe(
                'Must be between 2000-01-01 and 2020-01-01 (inclusive)'
            )
        })
    })
})

describe('getConfigErrors — configs that would block every value', () => {
    const d = new Date()
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

    it('rejects a numeric between whose minimum is above its maximum', () => {
        expect(
            getConfigErrors(numericDE, {
                numericOperator: 'between',
                numericValue: 10,
                numericValueMax: 5,
            })
        ).toEqual(['MIN_GREATER_THAN_MAX'])
        expect(
            getConfigErrors(numericDE, {
                numericOperator: 'between',
                numericValue: 5,
                numericValueMax: 5,
            })
        ).toEqual([])
    })

    it.each([
        [
            'fixed after fixed',
            {
                comparisonDateMode: 'fixed',
                fixedComparisonDate: '2027-12-31',
                upperComparisonDateMode: 'fixed',
                upperFixedComparisonDate: '2027-01-01',
            },
        ],
        [
            'relative after relative',
            {
                comparisonDateMode: 'relative',
                relativeComparisonAmount: 5,
                relativeComparisonDirection: 'future',
                upperComparisonDateMode: 'relative',
                upperRelativeComparisonAmount: 5,
                upperRelativeComparisonDirection: 'past',
            },
        ],
        [
            'current after a past offset',
            {
                comparisonDateMode: 'current',
                upperComparisonDateMode: 'relative',
                upperRelativeComparisonAmount: 1,
                upperRelativeComparisonDirection: 'past',
            },
        ],
        [
            'a future fixed date after the current date',
            {
                comparisonDateMode: 'fixed',
                fixedComparisonDate: '2999-01-01',
                upperComparisonDateMode: 'current',
            },
        ],
    ] as const)(
        'rejects a date between whose lower bound is after the upper (%s)',
        (_label, bounds) => {
            expect(
                getConfigErrors(dateDE, { operator: 'between', ...bounds })
            ).toEqual(['EMPTY_DATE_RANGE'])
        }
    )

    it.each([
        [
            'same fixed date',
            {
                comparisonDateMode: 'fixed',
                fixedComparisonDate: '2027-01-01',
                upperComparisonDateMode: 'fixed',
                upperFixedComparisonDate: '2027-01-01',
            },
        ],
        [
            'current .. current',
            {
                comparisonDateMode: 'current',
                upperComparisonDateMode: 'current',
            },
        ],
        [
            'today .. current',
            {
                comparisonDateMode: 'fixed',
                fixedComparisonDate: today,
                upperComparisonDateMode: 'current',
            },
        ],
        [
            'field bound (unknown order)',
            {
                comparisonDateMode: 'variable',
                comparisonDate: 'enrollment:enrollment_date',
                upperComparisonDateMode: 'fixed',
                upperFixedComparisonDate: '1900-01-01',
            },
        ],
    ] as const)(
        'accepts a date between that can hold a value (%s)',
        (_label, bounds) => {
            expect(
                getConfigErrors(dateDE, { operator: 'between', ...bounds })
            ).toEqual([])
        }
    )

    it.each([0, -5, 1.5])('rejects a "within" interval of %s', (amount) => {
        expect(
            getConfigErrors(dateDE, {
                operator: 'within_before',
                intervalAmount: amount,
                intervalUnit: 'days',
                comparisonDateMode: 'current',
            })
        ).toEqual(['INTERVAL_TOO_SMALL'])
    })

    it.each([0, -3, 2.5])('rejects a relative offset of %s', (amount) => {
        expect(
            getConfigErrors(dateDE, {
                operator: 'before',
                comparisonDateMode: 'relative',
                relativeComparisonAmount: amount,
            })
        ).toEqual(['OFFSET_TOO_SMALL'])
        expect(
            getConfigErrors(dateDE, {
                operator: 'between',
                comparisonDateMode: 'current',
                upperComparisonDateMode: 'relative',
                upperRelativeComparisonAmount: amount,
                upperRelativeComparisonDirection: 'future',
            })
        ).toEqual(['OFFSET_TOO_SMALL'])
    })

    it('accepts ordinary configs', () => {
        expect(
            getConfigErrors(dateDE, {
                operator: 'within_after',
                intervalAmount: 7,
                intervalUnit: 'days',
                comparisonDateMode: 'current',
            })
        ).toEqual([])
        expect(
            getConfigErrors(numericDE, {
                numericOperator: 'less_than',
                numericValue: -4,
            })
        ).toEqual([])
    })

    it('works for bulk templates (category instead of a variable)', () => {
        expect(
            getConfigErrors(
                { category: 'numeric' },
                {
                    numericOperator: 'between',
                    numericValue: 3,
                    numericValueMax: 1,
                }
            )
        ).toEqual(['MIN_GREATER_THAN_MAX'])
    })
})

describe('buildEditConfig — defaults', () => {
    const meta = makeMeta({
        programRuleVariables: [
            {
                id: 'prv01AAAAAA',
                name: 'PRV_VACC',
                dataElement: { id: 'deDate01AAAA' },
                programRuleVariableSourceType: 'DATAELEMENT_CURRENT_EVENT',
            },
        ],
    })
    const action: ProgramRuleAction = {
        id: 'act01AAAAAA',
        programRule: { id: 'rule01AAAAA' },
        programRuleActionType: 'SHOWERROR',
        content: 'Must be on or after Enrollment date',
    }
    const rule = makeRule({
        name: 'OLD - Vaccination date must be on or after Enrollment date',
        description:
            '[DVT] Validates that Vaccination date is on the same date or after Enrollment date',
        condition:
            'd2:hasValue(#{PRV_VACC}) && d2:hasValue(V{enrollment_date}) && d2:daysBetween(#{PRV_VACC}, V{enrollment_date}) > 0',
    })

    it('defaults the relative unit to days (the only unit the engine supports)', () => {
        const parsed = parseRuleCondition(rule.condition, meta, 'stg01')
        const config = buildEditConfig(
            parsed!,
            rule,
            action,
            dateDE,
            allVariables,
            'NEW'
        )
        expect(config.relativeComparisonUnit).toBe('days')
    })

    it('treats a generated name under a since-changed prefix as the default', () => {
        const parsed = parseRuleCondition(rule.condition, meta, 'stg01')
        const config = buildEditConfig(
            parsed!,
            rule,
            action,
            dateDE,
            allVariables,
            'NEW'
        )
        expect(config.ruleName).toBeUndefined()
    })
})

describe('interval wording', () => {
    it.each([
        [1, 'months', 'within 1 month before'],
        [2, 'months', 'within 2 months before'],
        [1, 'days', 'within 1 day before'],
        [1, 'weeks', 'within 1 week before'],
        [1, 'years', 'within 1 year before'],
    ])('%s %s → "%s"', (amount, unit, phrase) => {
        const preview = getValidationPreview(
            dateDE,
            {
                operator: 'within_before',
                intervalAmount: amount,
                intervalUnit: unit,
                comparisonDateMode: 'current',
            },
            allVariables
        )
        expect(preview.suggestedRuleName).toContain(phrase)
        expect(
            getBatchTemplateSummary({
                category: 'date',
                scope: 'programme',
                operator: 'within_before',
                intervalAmount: amount,
                intervalUnit: unit,
                comparisonDateMode: 'current',
            })
        ).toContain(phrase)
    })
})

describe('relative bound wording', () => {
    it('says "1 day", not "1 days"', () => {
        const preview = getValidationPreview(
            dateDE,
            {
                operator: 'before',
                comparisonDateMode: 'relative',
                relativeComparisonAmount: 1,
                relativeComparisonUnit: 'days',
                relativeComparisonDirection: 'future',
            },
            allVariables
        )
        expect(preview.suggestedRuleName).toContain(
            'before 1 day after current date'
        )
        expect(buildRelativeDateTarget(1, 'days', 'past')?.name).toBe(
            '1 day before current date'
        )
        expect(
            getBatchTemplateSummary({
                category: 'date',
                scope: 'programme',
                operator: 'before',
                comparisonDateMode: 'relative',
                relativeComparisonAmount: 1,
                relativeComparisonUnit: 'days',
                relativeComparisonDirection: 'past',
            })
        ).toContain('1 day before current date')
    })
})

describe('isBasicInfoDate — rules Android Capture does not show (ANDROAPP-7843)', () => {
    it.each(['enrollment', 'incident', 'event_date', 'due_date'] as const)(
        '%s → true',
        (type) => {
            expect(
                isBasicInfoDate(makeVariable({ type, category: 'date' }))
            ).toBe(true)
        }
    )
    it.each(['dataElement', 'trackedEntityAttribute'] as const)(
        '%s → false',
        (type) => {
            expect(
                isBasicInfoDate(makeVariable({ type, category: 'date' }))
            ).toBe(false)
        }
    )
})
