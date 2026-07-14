import { describe, expect, it } from 'vitest'
import { makeMeta, makeRule, makeVariable } from './helpers'
import { parseRuleCondition } from '@/lib/signature'
import type { BatchTemplate, ProgramRuleAction, Variable } from '@/lib/types'
import {
    buildEditConfig,
    buildRelativeDateTarget,
    createBatchTemplateKey,
    getBatchTemplateSummary,
    getDateComparisonOptions,
    getMissingFieldLabels,
    getUnvalidatedVariables,
    getValidationPreview,
    isConfigComplete,
    resolveDateComparisonTarget,
} from '@/lib/validation'

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
            },
        ],
        programRules: [
            makeRule({
                id: 'rule01AAAAA',
                condition:
                    'd2:hasValue(#{PRV_VACC}) && d2:daysBetween(#{PRV_VACC}, V{enrollment_date}) < 0',
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
                "d2:hasValue(#{PRV_VACC}) && d2:daysBetween(#{PRV_VACC}, '1900-01-01') > 0",
        })
        const parsed = parseRuleCondition(rule.condition, meta, dateDE)
        const config = buildEditConfig(parsed!, rule, action, dateDE, 'EIR')
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
        const parsed = parseRuleCondition(rule.condition, meta, dateDE)
        const config = buildEditConfig(parsed!, rule, action, dateDE)
        expect(config.comparisonDateMode).toBe('relative')
        expect(config.relativeComparisonAmount).toBe(100)
        expect(config.relativeComparisonUnit).toBe('days')
        expect(config.relativeComparisonDirection).toBe('past')
    })

    it('maps a variable comparison back to a comparison key', () => {
        const rule = makeRule({
            condition:
                'd2:hasValue(#{PRV_VACC}) && d2:daysBetween(#{PRV_VACC}, V{enrollment_date}) < 0',
        })
        const parsed = parseRuleCondition(rule.condition, meta, dateDE)
        const config = buildEditConfig(parsed!, rule, action, dateDE)
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
                },
            ],
        })
        const rule = makeRule({
            condition: 'd2:hasValue(#{PRV_AGE}) && #{PRV_AGE} >= 0',
        })
        const parsed = parseRuleCondition(
            rule.condition,
            numericMeta,
            numericDE
        )
        const config = buildEditConfig(parsed!, rule, action, numericDE)
        expect(config.numericOperator).toBe('greater_than_or_equal')
        expect(config.numericComparisonType).toBe('value')
        expect(config.numericValue).toBe(0)
    })

    it('round-trips a numeric between into min/max form config', () => {
        const numericMeta = makeMeta({
            programRuleVariables: [
                {
                    id: 'prvAge01AAA',
                    name: 'PRV_AGE',
                    dataElement: { id: 'deAge01AAAAA' },
                    programStage: { id: 'stg01' },
                },
            ],
        })
        const rule = makeRule({
            condition:
                'd2:hasValue(#{PRV_AGE}) && #{PRV_AGE} >= 0 && #{PRV_AGE} <= 115',
        })
        const parsed = parseRuleCondition(
            rule.condition,
            numericMeta,
            numericDE
        )
        const config = buildEditConfig(parsed!, rule, action, numericDE)
        expect(config.numericOperator).toBe('between')
        expect(config.numericValue).toBe(0)
        expect(config.numericValueMax).toBe(115)
    })

    it('round-trips a date between into lower and upper bound config', () => {
        const rule = makeRule({
            condition:
                "d2:hasValue(#{PRV_VACC}) && d2:daysBetween(#{PRV_VACC}, '2000-01-01') <= 0 && " +
                'd2:daysBetween(#{PRV_VACC}, V{current_date}) >= 0',
        })
        const parsed = parseRuleCondition(rule.condition, meta, dateDE)
        const config = buildEditConfig(parsed!, rule, action, dateDE)
        expect(config.operator).toBe('between')
        expect(config.comparisonDateMode).toBe('fixed')
        expect(config.fixedComparisonDate).toBe('2000-01-01')
        expect(config.upperComparisonDateMode).toBe('current')
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
        expect(preview.preview).toBe('Age should be between 0 and 115')
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
            'Enrollment date should be between 1 years before current date and Current date'
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
