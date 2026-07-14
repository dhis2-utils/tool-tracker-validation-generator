import { describe, expect, it } from 'vitest'
import { makeVariable } from './helpers'
import {
    generateBetweenDateCondition,
    generateNewRuleCondition,
    generateNumericBetweenCondition,
    generateNumericCondition,
    generateNumericFieldCondition,
    generateRuleName,
    getVariableReference,
    isSystemVariable,
} from '@/lib/builder'

const enrollment = makeVariable({ type: 'enrollment', id: 'enrollment_date' })
const eventDate = makeVariable({
    type: 'event_date',
    id: 'event_date_stg01',
    stageId: 'stg01',
})
const dateDE = makeVariable({
    type: 'dataElement',
    id: 'deAbc',
    stageId: 'stg01',
    prvName: 'EIR_DE_DATE',
})
const dateTEA = makeVariable({
    type: 'trackedEntityAttribute',
    id: 'teaAbc',
    prvName: 'EIR_TEA_DATE',
})
const fixedDate = makeVariable({
    type: 'fixed_date',
    id: '1900-01-01',
    name: '1900-01-01',
})
const relativeCurrentDate = makeVariable({
    type: 'relative_current_date',
    id: 'current_date_past_100_days',
    name: '100 days before current date',
    relativeAmount: 100,
    relativeUnit: 'days',
    relativeDirection: 'past',
})

describe('between conditions', () => {
    it('builds a numeric between as an inclusive compound condition', () => {
        const numDE = makeVariable({
            type: 'dataElement',
            id: 'ageAbc',
            prvName: 'EIR_AGE',
        })
        expect(generateNumericBetweenCondition(numDE, 0, 115)).toBe(
            'd2:hasValue(#{EIR_AGE}) && #{EIR_AGE} >= 0 && #{EIR_AGE} <= 115'
        )
    })

    it('builds a date between with lower <= 0 and upper >= 0 clauses', () => {
        const currentDate = makeVariable({
            type: 'current_date',
            id: 'current_date',
        })
        // reporting date between (1 year ago) and today, inclusive
        expect(
            generateBetweenDateCondition(
                enrollment,
                relativeCurrentDate,
                currentDate
            )
        ).toBe(
            'd2:daysBetween(V{enrollment_date}, d2:addDays(V{current_date}, -100)) <= 0 && ' +
                'd2:daysBetween(V{enrollment_date}, V{current_date}) >= 0'
        )
    })
})

describe('generateNewRuleCondition — null guards', () => {
    it('adds d2:hasValue guard for dataElement variable', () => {
        const condition = generateNewRuleCondition(dateDE, enrollment, {
            operator: 'before',
        })
        expect(condition).toContain('d2:hasValue(#{EIR_DE_DATE})')
        expect(condition).toContain('d2:daysBetween')
    })

    it('adds d2:hasValue guard for trackedEntityAttribute variable', () => {
        const condition = generateNewRuleCondition(dateTEA, enrollment, {
            operator: 'after',
        })
        expect(condition).toContain('d2:hasValue(#{EIR_TEA_DATE})')
    })

    it('does NOT add guard for enrollment_date (system variable)', () => {
        const condition = generateNewRuleCondition(enrollment, eventDate, {
            operator: 'before',
        })
        expect(condition).not.toContain('d2:hasValue')
    })

    it('does NOT add guard for event_date (system variable)', () => {
        const condition = generateNewRuleCondition(eventDate, enrollment, {
            operator: 'after',
        })
        expect(condition).not.toContain('d2:hasValue')
    })
})

const numDE = makeVariable({
    type: 'dataElement',
    id: 'deAge01AAAAA',
    stageId: 'stg01',
    prvName: 'EIR_AGE',
})
const numDE2 = makeVariable({
    type: 'dataElement',
    id: 'deWeight01AA',
    stageId: 'stg01',
    prvName: 'EIR_WEIGHT',
})

describe('generateNumericCondition — variable vs fixed value', () => {
    it('greater_than produces correct expression', () => {
        const c = generateNumericCondition(numDE, 'greater_than', 0)
        expect(c).toBe('d2:hasValue(#{EIR_AGE}) && #{EIR_AGE} > 0')
    })
    it('less_than_or_equal produces correct expression', () => {
        const c = generateNumericCondition(numDE, 'less_than_or_equal', 120)
        expect(c).toBe('d2:hasValue(#{EIR_AGE}) && #{EIR_AGE} <= 120')
    })
    it('equal_to produces == expression', () => {
        const c = generateNumericCondition(numDE, 'equal_to', 5)
        expect(c).toBe('d2:hasValue(#{EIR_AGE}) && #{EIR_AGE} == 5')
    })
    it('throws on unknown operator', () => {
        expect(() => generateNumericCondition(numDE, 'between', 5)).toThrow()
    })
})

describe('generateNumericFieldCondition — variable vs variable', () => {
    it('greater_than produces field comparison', () => {
        const c = generateNumericFieldCondition(numDE, 'greater_than', numDE2)
        expect(c).toBe('d2:hasValue(#{EIR_AGE}) && #{EIR_AGE} > #{EIR_WEIGHT}')
    })
})

describe('isSystemVariable', () => {
    it('returns true for enrollment', () =>
        expect(isSystemVariable(enrollment)).toBe(true))
    it('returns true for event_date', () =>
        expect(isSystemVariable(eventDate)).toBe(true))
    it('returns true for fixed_date', () =>
        expect(isSystemVariable(fixedDate)).toBe(true))
    it('returns true for relative_current_date', () =>
        expect(isSystemVariable(relativeCurrentDate)).toBe(true))
    it('returns false for dataElement', () =>
        expect(isSystemVariable(dateDE)).toBe(false))
    it('returns false for trackedEntityAttribute', () =>
        expect(isSystemVariable(dateTEA)).toBe(false))
})

describe('date literal and relative references', () => {
    it('renders a fixed ISO date as a quoted literal', () => {
        expect(getVariableReference(fixedDate)).toBe("'1900-01-01'")
    })

    it('renders a relative current date with a negative offset for past dates', () => {
        expect(getVariableReference(relativeCurrentDate)).toBe(
            'd2:addDays(V{current_date}, -100)'
        )
    })

    it('builds date conditions against a fixed date literal', () => {
        const condition = generateNewRuleCondition(dateDE, fixedDate, {
            operator: 'after',
        })
        expect(condition).toBe(
            "d2:hasValue(#{EIR_DE_DATE}) && d2:daysBetween(#{EIR_DE_DATE}, '1900-01-01') > 0"
        )
    })

    it('builds date conditions against a relative current date', () => {
        const condition = generateNewRuleCondition(
            dateDE,
            relativeCurrentDate,
            {
                operator: 'on_or_after',
            }
        )
        expect(condition).toBe(
            'd2:hasValue(#{EIR_DE_DATE}) && d2:daysBetween(#{EIR_DE_DATE}, d2:addDays(V{current_date}, -100)) >= 0'
        )
    })
})

describe('generateRuleName', () => {
    it('includes stage context for repeated stage-bound dates', () => {
        const dueDate = makeVariable({
            type: 'due_date',
            name: 'Due date',
            stageId: 'stageA',
            stageName: 'VISITS',
        })
        const currentDate = makeVariable({
            type: 'current_date',
            name: 'Current date',
        })

        expect(generateRuleName(dueDate, currentDate, 'on_or_before')).toBe(
            'Date validation: Due date (VISITS) should be on or before Current date'
        )
    })
})
