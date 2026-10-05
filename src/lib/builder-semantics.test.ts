// What the generated conditions DO at data entry, evaluated by the DHIS2 rule
// engine (the one Capture, Android and the server use). A SHOWERROR rule
// fires when its condition is true, so "fires" = the value is rejected.
import { describe, expect, it } from 'vitest'
import {
    generateBetweenDateCondition,
    generateNewRuleCondition,
    generateNumericBetweenCondition,
    generateNumericCondition,
    generateNumericFieldCondition,
} from '@/lib/builder'
import type { Variable } from '@/lib/types'
import { makeVariable } from '@/test-utils/helpers'
import { daysFromToday, EngineVariable, fires } from '@/test-utils/ruleEngine'

const dateDE = (name: string): Variable =>
    makeVariable({
        type: 'dataElement',
        id: name,
        name,
        prvName: name,
        stageId: 'stage000001',
    })
const X = dateDE('X')
const E = dateDE('E')
const DATES: EngineVariable[] = [
    { name: 'X', source: 'dataElement', valueType: 'DATE' },
    { name: 'E', source: 'dataElement', valueType: 'DATE' },
]
const NUMS: EngineVariable[] = [
    { name: 'A', source: 'dataElement', valueType: 'NUMERIC' },
    { name: 'B', source: 'dataElement', valueType: 'NUMERIC' },
]
const currentDate = makeVariable({ type: 'current_date', id: 'current_date' })
const enrollment = makeVariable({ type: 'enrollment', id: 'enrollment_date' })

describe('before / after / on or before / on or after', () => {
    // [operator, rejects yesterday, rejects today, rejects tomorrow]
    const cases: [string, boolean, boolean, boolean][] = [
        ['before', false, true, true],
        ['on_or_before', false, false, true],
        ['after', true, true, false],
        ['on_or_after', true, false, false],
    ]
    it.each(cases)(
        'X %s current date: rejects yesterday=%s today=%s tomorrow=%s',
        (operator, yesterday, today, tomorrow) => {
            const c = generateNewRuleCondition(X, currentDate, { operator })
            const at = (offset: number) =>
                fires(c, DATES, { values: { X: daysFromToday(offset) } })
            expect([at(-1), at(0), at(1)]).toEqual([yesterday, today, tomorrow])
        }
    )

    it.each(cases)(
        'X %s E (field to field) on the boundary day',
        (operator, yesterday, today, tomorrow) => {
            const c = generateNewRuleCondition(X, E, { operator })
            const at = (x: string) =>
                fires(c, DATES, { values: { X: x, E: '2027-10-30' } })
            expect([
                at('2027-10-29'),
                at('2027-10-30'),
                at('2027-10-31'),
            ]).toEqual([yesterday, today, tomorrow])
        }
    )

    it.each(cases.map(([op]) => op))(
        'X %s E never fires while either date is empty',
        (operator) => {
            const c = generateNewRuleCondition(X, E, { operator })
            expect(fires(c, DATES, { values: { X: '2027-10-30' } })).toBe(false)
            expect(fires(c, DATES, { values: { E: '2027-10-30' } })).toBe(false)
            expect(fires(c, DATES, { values: {} })).toBe(false)
        }
    )
})

describe('within N units before / after (inclusive on both ends)', () => {
    const within = (
        operator: 'within_before' | 'within_after',
        amount: number,
        unit: string
    ) =>
        generateNewRuleCondition(X, E, {
            operator,
            intervalAmount: amount,
            intervalUnit: unit,
        })
    const rejects = (condition: string, x: string, e: string) =>
        fires(condition, DATES, { values: { X: x, E: e } })

    it('"within 7 days before 2027-10-30" accepts 2027-10-23 … 2027-10-30 only', () => {
        const c = within('within_before', 7, 'days')
        expect(rejects(c, '2027-10-22', '2027-10-30')).toBe(true)
        expect(rejects(c, '2027-10-23', '2027-10-30')).toBe(false)
        expect(rejects(c, '2027-10-27', '2027-10-30')).toBe(false)
        expect(rejects(c, '2027-10-30', '2027-10-30')).toBe(false)
        expect(rejects(c, '2027-10-31', '2027-10-30')).toBe(true)
        expect(rejects(c, '2027-12-31', '2027-10-30')).toBe(true)
        expect(rejects(c, '2020-01-01', '2027-10-30')).toBe(true)
    })

    it('"within 7 days after 2027-10-30" accepts 2027-10-30 … 2027-11-06 only', () => {
        const c = within('within_after', 7, 'days')
        expect(rejects(c, '2027-10-29', '2027-10-30')).toBe(true)
        expect(rejects(c, '2027-10-30', '2027-10-30')).toBe(false)
        expect(rejects(c, '2027-11-06', '2027-10-30')).toBe(false)
        expect(rejects(c, '2027-11-07', '2027-10-30')).toBe(true)
        expect(rejects(c, '2020-01-01', '2027-10-30')).toBe(true)
    })

    it('weeks are exact multiples of 7 days', () => {
        const before = within('within_before', 2, 'weeks')
        expect(rejects(before, '2027-10-16', '2027-10-30')).toBe(false)
        expect(rejects(before, '2027-10-15', '2027-10-30')).toBe(true)
        const after = within('within_after', 2, 'weeks')
        expect(rejects(after, '2027-11-13', '2027-10-30')).toBe(false)
        expect(rejects(after, '2027-11-14', '2027-10-30')).toBe(true)
    })

    it('months are calendar months, clamped at month end', () => {
        const before = within('within_before', 1, 'months')
        expect(rejects(before, '2027-09-30', '2027-10-30')).toBe(false)
        expect(rejects(before, '2027-09-29', '2027-10-30')).toBe(true)
        // 2027-09-30 minus one month = 2027-08-30
        expect(rejects(before, '2027-08-30', '2027-09-30')).toBe(false)
        expect(rejects(before, '2027-08-29', '2027-09-30')).toBe(true)
        const after = within('within_after', 1, 'months')
        // 2027-01-31 plus one month = 2027-02-28
        expect(rejects(after, '2027-02-28', '2027-01-31')).toBe(false)
        expect(rejects(after, '2027-03-01', '2027-01-31')).toBe(true)
        expect(rejects(after, '2027-03-30', '2027-02-28')).toBe(true)
        expect(rejects(after, '2027-03-28', '2027-02-28')).toBe(false)
    })

    it('years handle 29 February', () => {
        const before = within('within_before', 1, 'years')
        expect(rejects(before, '2027-02-28', '2028-02-29')).toBe(false)
        expect(rejects(before, '2027-02-27', '2028-02-29')).toBe(true)
        const after = within('within_after', 1, 'years')
        expect(rejects(after, '2029-02-28', '2028-02-29')).toBe(false)
        expect(rejects(after, '2029-03-01', '2028-02-29')).toBe(true)
    })

    it.each([
        ['within_before', 'days'],
        ['within_after', 'days'],
        ['within_before', 'months'],
        ['within_after', 'years'],
    ] as const)(
        '%s (%s) never fires while either date is empty',
        (op, unit) => {
            const c = within(op, 3, unit)
            expect(fires(c, DATES, { values: { X: '2027-10-30' } })).toBe(false)
            expect(fires(c, DATES, { values: { E: '2027-10-30' } })).toBe(false)
        }
    )

    it('works against a system date (enrollment date)', () => {
        const c = generateNewRuleCondition(X, enrollment, {
            operator: 'within_before',
            intervalAmount: 7,
            intervalUnit: 'days',
        })
        const at = (x: string) =>
            fires(c, DATES, {
                values: { X: x },
                enrollmentDate: '2027-10-30',
            })
        expect([
            at('2027-10-22'),
            at('2027-10-23'),
            at('2027-10-30'),
            at('2027-10-31'),
        ]).toEqual([true, false, false, true])
    })

    // Exhaustive check against an exact calendar reference (java.time-style
    // plusMonths, clamped to the last day of the month), around every limit.
    const iso = (d: Date) => d.toISOString().slice(0, 10)
    const addDays = (d: Date, n: number) =>
        new Date(
            Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n)
        )
    const addMonths = (d: Date, n: number) => {
        const y = d.getUTCFullYear()
        const m = d.getUTCMonth() + n
        const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
        return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), last)))
    }
    const limitFor = (e: Date, n: number, unit: string, sign: 1 | -1) =>
        unit === 'days'
            ? addDays(e, sign * n)
            : unit === 'weeks'
              ? addDays(e, sign * 7 * n)
              : addMonths(e, sign * n * (unit === 'years' ? 12 : 1))

    it.each(['days', 'weeks', 'months', 'years'])(
        'matches the calendar definition for every reference date in 2028 (%s)',
        (unit) => {
            const wrong: string[] = []
            for (const op of ['within_before', 'within_after'] as const) {
                const n = 2
                const c = within(op, n, unit)
                for (
                    let e = new Date(Date.UTC(2028, 0, 1));
                    e < new Date(Date.UTC(2029, 0, 1));
                    e = addDays(e, 1)
                ) {
                    const limit = limitFor(
                        e,
                        n,
                        unit,
                        op === 'within_before' ? -1 : 1
                    )
                    for (const x of [
                        addDays(limit, -1),
                        limit,
                        addDays(limit, 1),
                        addDays(e, -1),
                        e,
                        addDays(e, 1),
                    ]) {
                        const inWindow =
                            op === 'within_before'
                                ? x >= limit && x <= e
                                : x >= e && x <= limit
                        if (rejects(c, iso(x), iso(e)) === inWindow) {
                            wrong.push(`${op} E=${iso(e)} X=${iso(x)}`)
                        }
                    }
                }
            }
            expect(wrong.slice(0, 5)).toEqual([])
        },
        60000
    )
})

describe('date between (inclusive)', () => {
    it('accepts both bounds and rejects outside', () => {
        const lower = makeVariable({ type: 'fixed_date', id: '2027-01-01' })
        const upper = makeVariable({ type: 'fixed_date', id: '2027-12-31' })
        const c = generateBetweenDateCondition(X, lower, upper)
        const at = (x: string) => fires(c, DATES, { values: { X: x } })
        expect([
            at('2026-12-31'),
            at('2027-01-01'),
            at('2027-12-31'),
            at('2028-01-01'),
        ]).toEqual([true, false, false, true])
        expect(fires(c, DATES, { values: {} })).toBe(false)
    })

    it('never fires while a bound field is empty', () => {
        const upper = makeVariable({ type: 'fixed_date', id: '2027-12-31' })
        const c = generateBetweenDateCondition(X, E, upper)
        expect(fires(c, DATES, { values: { X: '2020-01-01' } })).toBe(false)
    })
})

describe('numeric conditions', () => {
    const A = makeVariable({
        type: 'dataElement',
        id: 'A',
        prvName: 'A',
        category: 'numeric',
    })
    const B = makeVariable({
        type: 'dataElement',
        id: 'B',
        prvName: 'B',
        category: 'numeric',
    })
    const rejectsA = (c: string, a?: string, b?: string) =>
        fires(c, NUMS, { values: { A: a, B: b } })

    it.each([
        ['greater_than', 5, ['4', '5'], ['6']],
        ['greater_than_or_equal', 5, ['4'], ['5', '6']],
        ['less_than', 5, ['5', '6'], ['4']],
        ['less_than_or_equal', 5, ['6'], ['4', '5']],
        ['equal_to', 5, ['4', '6'], ['5']],
        ['not_equal_to', 5, ['5'], ['4']],
    ] as const)('A %s %s', (op, n, rejected, accepted) => {
        const c = generateNumericCondition(A, op, n)
        for (const v of rejected) {
            expect(rejectsA(c, v)).toBe(true)
        }
        for (const v of accepted) {
            expect(rejectsA(c, v)).toBe(false)
        }
        expect(rejectsA(c, undefined)).toBe(false)
    })

    it('between is inclusive and ignores an empty value', () => {
        const c = generateNumericBetweenCondition(A, 0, 120)
        expect(['-1', '0', '120', '121'].map((v) => rejectsA(c, v))).toEqual([
            true,
            false,
            false,
            true,
        ])
        expect(rejectsA(c, undefined)).toBe(false)
    })

    it('field to field never fires while the other field is empty', () => {
        const c = generateNumericFieldCondition(A, 'less_than', B)
        expect(rejectsA(c, '80', '120')).toBe(false)
        expect(rejectsA(c, '130', '120')).toBe(true)
        // B empty would evaluate as 0 without a guard on B
        expect(rejectsA(c, '80', undefined)).toBe(false)
        expect(rejectsA(c, undefined, '120')).toBe(false)
    })
})
