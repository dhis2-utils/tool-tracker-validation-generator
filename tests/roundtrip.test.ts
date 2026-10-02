// The parser must read back exactly what the builder wrote: parse → edit
// config → rebuild has to reproduce the stored condition byte for byte, so
// opening and re-saving a rule can never change what it does. Anything that
// is not exactly an app shape must parse to null (and so never be edited).
import { describe, expect, it } from 'vitest'
import { makeMeta, makeRule, makeVariable } from './helpers'
import {
    generateBetweenDateCondition,
    generateNewRuleCondition,
    generateNumericBetweenCondition,
    generateNumericCondition,
    generateNumericFieldCondition,
} from '@/lib/builder'
import { parseRuleCondition } from '@/lib/parser'
import type {
    ParsedRuleCondition,
    ProgramRuleAction,
    Variable,
} from '@/lib/types'
import {
    buildEditConfig,
    resolveDateComparisonTarget,
    resolveUpperDateComparisonTarget,
} from '@/lib/validation'
import { findVariableByKey } from '@/lib/variables'

const STAGE = 'stage00001A'
const OTHER_STAGE = 'stage00002B'

const meta = makeMeta({
    programRuleVariables: [
        {
            id: 'prvX0000001',
            name: 'P_X',
            dataElement: { id: 'deX00000001' },
            programRuleVariableSourceType: 'DATAELEMENT_CURRENT_EVENT',
        },
        {
            id: 'prvE0000001',
            name: 'P_E',
            dataElement: { id: 'deE00000001' },
            programRuleVariableSourceType: 'DATAELEMENT_CURRENT_EVENT',
        },
        {
            id: 'prvT0000001',
            name: 'P_DOB',
            trackedEntityAttribute: { id: 'teaDob00001' },
            programRuleVariableSourceType: 'TEI_ATTRIBUTE',
        },
        {
            id: 'prvA0000001',
            name: 'P_A',
            dataElement: { id: 'deA00000001' },
            programRuleVariableSourceType: 'DATAELEMENT_CURRENT_EVENT',
        },
        {
            id: 'prvB0000001',
            name: 'P_B',
            dataElement: { id: 'deB00000001' },
            programRuleVariableSourceType: 'DATAELEMENT_CURRENT_EVENT',
        },
        {
            id: 'prvG0000001',
            name: 'P_AGE',
            trackedEntityAttribute: { id: 'teaAge00001' },
            programRuleVariableSourceType: 'TEI_ATTRIBUTE',
        },
    ],
})

// The app's own variable list (ids as buildVariablesArray makes them).
const variables: Variable[] = [
    {
        id: 'enrollment_date',
        name: 'Enrollment date (enrollment date)',
        type: 'enrollment',
        category: 'date',
    },
    {
        id: 'incident_date',
        name: 'Incident date (incident date)',
        type: 'incident',
        category: 'date',
    },
    {
        id: 'current_date',
        name: 'Current date',
        type: 'current_date',
        category: 'date',
    },
    {
        id: `event_date_${STAGE}`,
        name: 'Visit date (event date)',
        type: 'event_date',
        category: 'date',
        stageId: STAGE,
        stageName: 'Visit',
    },
    {
        id: `due_date_${STAGE}`,
        name: 'Due date',
        type: 'due_date',
        category: 'date',
        stageId: STAGE,
        stageName: 'Visit',
    },
    {
        id: 'deX00000001',
        name: 'Sample date',
        type: 'dataElement',
        category: 'date',
        stageId: STAGE,
        stageName: 'Visit',
    },
    {
        id: 'deE00000001',
        name: 'Admission date',
        type: 'dataElement',
        category: 'date',
        stageId: STAGE,
        stageName: 'Visit',
    },
    {
        id: 'teaDob00001',
        name: 'Date of birth',
        type: 'trackedEntityAttribute',
        category: 'date',
    },
    {
        id: 'deA00000001',
        name: 'Diastolic',
        type: 'dataElement',
        category: 'numeric',
        stageId: STAGE,
        stageName: 'Visit',
    },
    {
        id: 'deB00000001',
        name: 'Systolic',
        type: 'dataElement',
        category: 'numeric',
        stageId: STAGE,
        stageName: 'Visit',
    },
    {
        id: 'teaAge00001',
        name: 'Age',
        type: 'trackedEntityAttribute',
        category: 'numeric',
    },
]
const PRV_NAMES: Record<string, string> = {
    deX00000001: 'P_X',
    deE00000001: 'P_E',
    teaDob00001: 'P_DOB',
    deA00000001: 'P_A',
    deB00000001: 'P_B',
    teaAge00001: 'P_AGE',
}
const v = (id: string): Variable => {
    const variable = variables.find((x) => x.id === id)!
    return PRV_NAMES[id] ? { ...variable, prvName: PRV_NAMES[id] } : variable
}
const withPrv = (variable: Variable | null): Variable | null =>
    variable && PRV_NAMES[variable.id]
        ? { ...variable, prvName: PRV_NAMES[variable.id] }
        : variable
const fixed = makeVariable({
    type: 'fixed_date',
    id: '2027-10-30',
    name: '2027-10-30',
})
const relPast = makeVariable({
    type: 'relative_current_date',
    id: 'current_date_past_30_days',
    relativeAmount: 30,
    relativeUnit: 'days',
    relativeDirection: 'past',
})
const relFuture = makeVariable({
    type: 'relative_current_date',
    id: 'current_date_future_7_days',
    relativeAmount: 7,
    relativeUnit: 'days',
    relativeDirection: 'future',
})
const action: ProgramRuleAction = {
    id: 'act00000001',
    programRule: { id: 'rule001AAAA' },
    programRuleActionType: 'SHOWERROR',
    content: 'x',
}

/** Rebuild the condition from what the edit form would be seeded with. */
function rebuild(parsed: ParsedRuleCondition, target: Variable): string {
    const cfg = buildEditConfig(
        parsed,
        makeRule({ name: 'n' }),
        action,
        target,
        variables
    )
    if (target.category === 'numeric') {
        if (cfg.numericOperator === 'between') {
            return generateNumericBetweenCondition(
                target,
                cfg.numericValue,
                cfg.numericValueMax
            )
        }
        if (cfg.numericComparisonType === 'field') {
            return generateNumericFieldCondition(
                target,
                cfg.numericOperator,
                withPrv(
                    findVariableByKey(
                        variables,
                        cfg.numericComparisonField ?? ''
                    )
                )!
            )
        }
        return generateNumericCondition(
            target,
            cfg.numericOperator,
            cfg.numericValue
        )
    }
    const lower = withPrv(resolveDateComparisonTarget(cfg, variables))!
    if (cfg.operator === 'between') {
        return generateBetweenDateCondition(
            target,
            lower,
            withPrv(resolveUpperDateComparisonTarget(cfg, variables))!
        )
    }
    return generateNewRuleCondition(target, lower, cfg)
}

const sameVariable = (a: Variable | null | undefined, b: Variable) =>
    a?.type === b.type &&
    a?.id === b.id &&
    (a?.stageId ?? '') === (b.stageId ?? '')

const DATE_TARGETS = [
    'deX00000001',
    'teaDob00001',
    'enrollment_date',
    'incident_date',
    `event_date_${STAGE}`,
]
const COMPARISONS: Variable[] = [
    v('current_date'),
    v('enrollment_date'),
    v(`event_date_${STAGE}`),
    v(`due_date_${STAGE}`),
    v('deE00000001'),
    v('teaDob00001'),
    fixed,
    relPast,
    relFuture,
]
const SINGLE_OPS = ['before', 'after', 'on_or_before', 'on_or_after']
const UNITS = ['days', 'weeks', 'months', 'years']

describe('date rules round-trip exactly', () => {
    const cases: [string, string, Variable, Record<string, unknown>][] = []
    for (const t of DATE_TARGETS) {
        for (const c of COMPARISONS) {
            if (c.id === t) {
                continue
            }
            for (const op of SINGLE_OPS) {
                cases.push([t, op, c, { operator: op }])
            }
            for (const op of ['within_before', 'within_after']) {
                for (const unit of UNITS) {
                    cases.push([
                        t,
                        `${op} 3 ${unit}`,
                        c,
                        { operator: op, intervalAmount: 3, intervalUnit: unit },
                    ])
                }
            }
        }
    }
    it.each(cases)('%s %s %o', (targetId, _label, comparison, config) => {
        const target = v(targetId)
        const condition = generateNewRuleCondition(target, comparison, config)
        const parsed = parseRuleCondition(condition, meta, STAGE)
        expect(parsed).not.toBeNull()
        expect(sameVariable(parsed!.variable1, target)).toBe(true)
        expect(parsed!.config.operator).toBe(config.operator)
        expect(rebuild(parsed!, target)).toBe(condition)
    })

    it.each([
        [v('current_date'), fixed],
        [fixed, v('current_date')],
        [relPast, relFuture],
        [v('enrollment_date'), v('deE00000001')],
        [v('teaDob00001'), v(`event_date_${STAGE}`)],
    ])('between %o and %o', (lower, upper) => {
        const target = v('deX00000001')
        const condition = generateBetweenDateCondition(target, lower, upper)
        const parsed = parseRuleCondition(condition, meta, STAGE)
        expect(parsed?.config.operator).toBe('between')
        expect(rebuild(parsed!, target)).toBe(condition)
    })
})

describe('numeric rules round-trip exactly', () => {
    const ops = [
        'greater_than',
        'greater_than_or_equal',
        'less_than',
        'less_than_or_equal',
        'equal_to',
        'not_equal_to',
    ]
    it.each(
        ops.flatMap((op) =>
            [-2.5, 0, 7, 120, 0.0000001].map((n) => [op, n] as const)
        )
    )('A %s %s', (op, n) => {
        const target = v('deA00000001')
        const condition = generateNumericCondition(target, op, n)
        const parsed = parseRuleCondition(condition, meta, STAGE)
        expect(parsed?.config.operator).toBe(op)
        expect(rebuild(parsed!, target)).toBe(condition)
    })
    it.each(ops)('A %s B (field)', (op) => {
        const target = v('deA00000001')
        const condition = generateNumericFieldCondition(
            target,
            op,
            v('deB00000001')
        )
        const parsed = parseRuleCondition(condition, meta, STAGE)
        expect(parsed?.config.comparisonType).toBe('field')
        expect(rebuild(parsed!, target)).toBe(condition)
    })
    it('between', () => {
        const target = v('teaAge00001')
        const condition = generateNumericBetweenCondition(target, 0, 120)
        const parsed = parseRuleCondition(condition, meta, STAGE)
        expect(parsed?.config).toMatchObject({
            operator: 'between',
            value: 0,
            valueMax: 120,
        })
        expect(rebuild(parsed!, target)).toBe(condition)
    })
})

describe('stage-bound system dates resolve to the rule stage', () => {
    it('reads V{event_date} as the event date of the rule stage', () => {
        const condition = generateNewRuleCondition(
            v('deX00000001'),
            v(`event_date_${STAGE}`),
            { operator: 'before' }
        )
        expect(
            parseRuleCondition(condition, meta, STAGE)?.variable2
        ).toMatchObject({
            type: 'event_date',
            id: `event_date_${STAGE}`,
            stageId: STAGE,
        })
        expect(
            parseRuleCondition(condition, meta, OTHER_STAGE)?.variable2
        ).toMatchObject({ id: `event_date_${OTHER_STAGE}` })
    })
    it('reads V{due_date}', () => {
        const condition = generateNewRuleCondition(
            v(`due_date_${STAGE}`),
            v('current_date'),
            { operator: 'on_or_after' }
        )
        expect(
            parseRuleCondition(condition, meta, STAGE)?.variable1
        ).toMatchObject({ type: 'due_date', id: `due_date_${STAGE}` })
    })
    it('refuses event or due date without a rule stage (it would mean every stage)', () => {
        const condition = generateNewRuleCondition(
            v('deX00000001'),
            v(`event_date_${STAGE}`),
            { operator: 'before' }
        )
        expect(parseRuleCondition(condition, meta)).toBeNull()
    })
})

describe('anything that is not exactly an app shape parses to null', () => {
    it.each([
        // foreign / hand-written
        '#{P_B} + #{P_A} > 10',
        'd2:hasValue(#{P_A}) && #{P_B} > 3',
        '#{P_A} > 5 && #{P_B} == 1',
        '#{P_A} <= 5', // no guard: would fire on an empty field
        'd2:hasValue(#{P_A}) && #{P_A} <= 5 && true',
        'd2:hasValue(#{P_A}) && #{P_A} >= #{P_B}', // second field unguarded
        // superseded app forms (pre-review)
        'd2:hasValue(#{P_X}) && d2:daysBetween(#{P_X}, V{enrollment_date}) > 30',
        'd2:hasValue(#{P_X}) && d2:daysBetween(V{enrollment_date}, #{P_X}) > 30',
        'd2:hasValue(#{P_X}) && d2:monthsBetween(#{P_X}, V{current_date}) > 3',
        'd2:hasValue(#{P_X}) && d2:daysBetween(#{P_X}, d2:addYears(V{current_date}, -1)) > 0',
        // unknown PRV
        'd2:hasValue(#{NOPE}) && d2:daysBetween(#{NOPE}, V{current_date}) < 0',
        // malformed
        'd2:hasValue(#{P_X}) && d2:daysBetween(#{P_X}, V{current_date}) < 0)',
        '',
    ])('%s', (condition) => {
        expect(parseRuleCondition(condition, meta, STAGE)).toBeNull()
    })
})
