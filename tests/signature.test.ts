import { describe, expect, it } from 'vitest'
import { makeMeta, makeRule, makeVariable } from './helpers'
import {
    addBatchSignature,
    BATCH_TAG,
    isBatchGenerated,
    parseRuleCondition,
} from '@/lib/signature'

const mockMeta = makeMeta({
    programRuleVariables: [
        {
            id: 'prv01AAAAAA',
            name: 'EIR_VACCINATION_DATE',
            dataElement: { id: 'deVacc01AAAA' },
            programStage: { id: 'stage001AAAAA' },
        },
        {
            id: 'prv02AAAAAA',
            name: 'EIR_DOB',
            trackedEntityAttribute: { id: 'teaDob01AAAA' },
        },
    ],
})

const targetVacc = makeVariable({
    type: 'dataElement',
    id: 'deVacc01AAAA',
    stageId: 'stage001AAAAA',
})

describe('parseRuleCondition — date comparisons', () => {
    it('parses before (daysBetween < 0)', () => {
        const result = parseRuleCondition(
            'd2:daysBetween(V{event_date}, V{enrollment_date}) < 0',
            mockMeta
        )
        expect(result?.config.operator).toBe('before')
    })

    it('parses on_or_after (daysBetween >= 0)', () => {
        const result = parseRuleCondition(
            'd2:daysBetween(V{event_date}, V{enrollment_date}) >= 0',
            mockMeta
        )
        expect(result?.config.operator).toBe('on_or_after')
    })

    it('parses fixed date literals as comparison targets', () => {
        const result = parseRuleCondition(
            "d2:daysBetween(#{EIR_VACCINATION_DATE}, '1900-01-01') > 0",
            mockMeta
        )
        expect(result?.variable2?.type).toBe('fixed_date')
        expect(result?.variable2?.id).toBe('1900-01-01')
        expect(result?.config.operator).toBe('after')
    })

    it('parses relative current-date offsets as comparison targets', () => {
        const result = parseRuleCondition(
            'd2:daysBetween(#{EIR_VACCINATION_DATE}, d2:addDays(V{current_date}, -100)) >= 0',
            mockMeta
        )
        expect(result?.variable2?.type).toBe('relative_current_date')
        expect(result?.variable2?.relativeDirection).toBe('past')
        expect(result?.variable2?.relativeAmount).toBe(100)
        expect(result?.variable2?.relativeUnit).toBe('days')
        expect(result?.config.operator).toBe('on_or_after')
    })
})

describe('parseRuleCondition — between', () => {
    it('parses a numeric between (min && max) on the same field', () => {
        const result = parseRuleCondition(
            'd2:hasValue(#{EIR_DOB}) && #{EIR_DOB} >= 0 && #{EIR_DOB} <= 115',
            mockMeta
        )
        expect(result?.config.operator).toBe('between')
        expect(result?.config.value).toBe(0)
        expect(result?.config.valueMax).toBe(115)
    })

    it('parses a date between into distinct lower and upper bounds', () => {
        const result = parseRuleCondition(
            'd2:daysBetween(V{enrollment_date}, d2:addDays(V{current_date}, -1)) <= 0 && ' +
                'd2:daysBetween(V{enrollment_date}, V{current_date}) >= 0',
            mockMeta
        )
        expect(result?.config.operator).toBe('between')
        expect(result?.variable2?.type).toBe('relative_current_date')
        expect(result?.variable2?.relativeAmount).toBe(1)
        expect(result?.variable2?.relativeDirection).toBe('past')
        expect(result?.variable3?.type).toBe('current_date')
    })

    it('does not misparse a single comparison as between', () => {
        const result = parseRuleCondition(
            'd2:daysBetween(V{event_date}, V{enrollment_date}) < 0',
            mockMeta
        )
        expect(result?.config.operator).toBe('before')
    })
})

describe('parseRuleCondition — interval direction', () => {
    it('detects within_after when target is first arg', () => {
        // within_after: d2:*Between(targetRef, compareRef)
        const condition =
            'd2:daysBetween(#{EIR_VACCINATION_DATE}, V{enrollment_date}) > 30'
        const result = parseRuleCondition(condition, mockMeta, targetVacc)
        expect(result?.config.operator).toBe('within_after')
        expect(result?.config.intervalAmount).toBe(30)
        expect(result?.config.intervalUnit).toBe('days')
    })

    it('detects within_before when target is second arg', () => {
        // within_before: d2:*Between(compareRef, targetRef)
        const condition =
            'd2:daysBetween(V{enrollment_date}, #{EIR_VACCINATION_DATE}) > 30'
        const result = parseRuleCondition(condition, mockMeta, targetVacc)
        expect(result?.config.operator).toBe('within_before')
    })

    it('defaults to within_after when no targetVariable given', () => {
        const condition =
            'd2:daysBetween(V{enrollment_date}, #{EIR_VACCINATION_DATE}) > 30'
        const result = parseRuleCondition(condition, mockMeta)
        expect(result?.config.operator).toBe('within_after')
    })
})

describe('parseRuleCondition — null guards', () => {
    it('parses condition with leading d2:hasValue guard', () => {
        const condition =
            'd2:hasValue(#{EIR_VACCINATION_DATE}) && d2:daysBetween(#{EIR_VACCINATION_DATE}, V{enrollment_date}) < 0'
        const result = parseRuleCondition(condition, mockMeta)
        expect(result).not.toBeNull()
        expect(result?.config.operator).toBe('before')
    })
})

describe('parseRuleCondition — numeric literal', () => {
    it('parses greater_than with fixed value', () => {
        const condition = 'd2:hasValue(#{EIR_AGE}) && #{EIR_AGE} > 0'
        const meta = makeMeta({
            programRuleVariables: [
                {
                    id: 'prvAge01AAA',
                    name: 'EIR_AGE',
                    dataElement: { id: 'deAge01AAAAA' },
                    programStage: { id: 'stg01' },
                },
            ],
        })
        const result = parseRuleCondition(condition, meta)
        expect(result).not.toBeNull()
        expect(result?.config.operator).toBe('greater_than')
        expect(result?.config.comparisonType).toBe('value')
        expect(result?.config.value).toBe(0)
        expect(result?.variable1.id).toBe('deAge01AAAAA')
    })
})

describe('parseRuleCondition — numeric field-to-field', () => {
    it('parses greater_than between two numeric fields', () => {
        const condition =
            'd2:hasValue(#{EIR_AGE}) && #{EIR_AGE} > #{EIR_WEIGHT}'
        const meta = makeMeta({
            programRuleVariables: [
                {
                    id: 'prvAge01AAA',
                    name: 'EIR_AGE',
                    dataElement: { id: 'deAge01AAAAA' },
                    programStage: { id: 'stg01' },
                },
                {
                    id: 'prvWgt01AAA',
                    name: 'EIR_WEIGHT',
                    dataElement: { id: 'deWeight01AA' },
                    programStage: { id: 'stg01' },
                },
            ],
        })
        const result = parseRuleCondition(condition, meta)
        expect(result).not.toBeNull()
        expect(result?.config.operator).toBe('greater_than')
        expect(result?.config.comparisonType).toBe('field')
        expect(result?.variable2?.id).toBe('deWeight01AA')
    })
})

describe('batch signature', () => {
    it('BATCH_TAG is the string DVT-BATCH', () => {
        expect(BATCH_TAG).toBe('DVT-BATCH')
    })

    it('addBatchSignature adds [DVT] and [DVT-BATCH] to description', () => {
        const result = addBatchSignature('My Rule', 'Some desc')
        expect(result.description.startsWith('[DVT]')).toBe(true)
        expect(result.description).toContain('[DVT-BATCH]')
    })

    it('addBatchSignature preserves the rule name', () => {
        const result = addBatchSignature('My Rule', 'Some desc')
        expect(result.name).toBe('My Rule')
    })

    it('isBatchGenerated returns true for batch-tagged rule', () => {
        const rule = makeRule({ description: '[DVT] [DVT-BATCH] Some desc' })
        expect(isBatchGenerated(rule)).toBe(true)
    })

    it('isBatchGenerated returns false for app rule without batch tag', () => {
        const rule = makeRule({ description: '[DVT] Some desc' })
        expect(isBatchGenerated(rule)).toBe(false)
    })

    it('addBatchSignature is idempotent (no duplicate tags)', () => {
        const result1 = addBatchSignature('Rule', 'desc')
        const result2 = addBatchSignature('Rule', result1.description)
        expect(result2.description).toBe(result1.description)
        expect((result2.description.match(/\[DVT-BATCH\]/g) || []).length).toBe(
            1
        )
    })

    it('isBatchGenerated requires [DVT] prefix, not just [DVT-BATCH] anywhere', () => {
        expect(
            isBatchGenerated(makeRule({ description: '[DVT-BATCH] desc' }))
        ).toBe(false)
    })
})
