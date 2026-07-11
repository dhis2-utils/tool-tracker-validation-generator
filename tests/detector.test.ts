import { describe, expect, it } from 'vitest'
import { makeMeta, makeVariable } from './helpers'
import { prGetExisting } from '@/lib/detector'

const numericVar = makeVariable({
    type: 'dataElement',
    id: 'deAge01AAAAA',
    stageId: 'stg01',
})

const mockMeta = makeMeta({
    programRuleVariables: [
        {
            id: 'prvAge01AAA',
            name: 'EIR_AGE',
            dataElement: { id: 'deAge01AAAAA' },
            programStage: { id: 'stg01' },
        },
    ],
    programRules: [
        {
            id: 'rule001AAAAA',
            name: 'Age rule',
            condition: 'd2:hasValue(#{EIR_AGE}) && #{EIR_AGE} > 0',
            programStage: { id: 'stg01' },
        },
    ],
    programRuleActions: [
        {
            id: 'action01AAAA',
            programRule: { id: 'rule001AAAAA' },
            programRuleActionType: 'SHOWERROR',
        },
    ],
})

describe('prGetExisting — numeric rules', () => {
    it('detects numeric rule for a dataElement variable', () => {
        const results = prGetExisting(mockMeta, numericVar)
        expect(results.length).toBe(1)
        expect(results[0].rule.id).toBe('rule001AAAAA')
    })
})

describe('prGetExisting — interval and stage-bound dates', () => {
    const stage = { id: 'stg01' }
    const metaWith = (condition: string, programStage?: { id: string }) =>
        makeMeta({
            programRuleVariables: [
                {
                    id: 'prvVacc01AA',
                    name: 'EIR_VACC',
                    dataElement: { id: 'deVacc01AAAA' },
                },
            ],
            programRules: [
                { id: 'ruleX01AAAA', name: 'X', condition, programStage },
            ],
            programRuleActions: [
                {
                    id: 'actX01AAAAA',
                    programRule: { id: 'ruleX01AAAA' },
                    programRuleActionType: 'SHOWERROR',
                },
            ],
        })

    it('attributes within_before rules (target as second argument)', () => {
        // "vaccination date within 30 days before enrollment" puts the
        // target second: d2:daysBetween(compare, target) > 30
        const meta = metaWith(
            'd2:hasValue(#{EIR_VACC}) && d2:daysBetween(V{enrollment_date}, #{EIR_VACC}) > 30'
        )
        const target = makeVariable({ type: 'dataElement', id: 'deVacc01AAAA' })
        expect(prGetExisting(meta, target).length).toBe(1)
    })

    it('does not attribute comparison rules to the second argument', () => {
        const meta = metaWith(
            'd2:daysBetween(V{enrollment_date}, #{EIR_VACC}) < 0'
        )
        const target = makeVariable({ type: 'dataElement', id: 'deVacc01AAAA' })
        expect(prGetExisting(meta, target).length).toBe(0)
    })

    it('detects due_date rules scoped to the same stage', () => {
        const meta = metaWith(
            'd2:daysBetween(V{due_date}, V{enrollment_date}) < 0',
            stage
        )
        const due = makeVariable({
            type: 'due_date',
            id: 'due_date_stg01',
            stageId: 'stg01',
        })
        const dueOther = makeVariable({
            type: 'due_date',
            id: 'due_date_stg02',
            stageId: 'stg02',
        })
        expect(prGetExisting(meta, due).length).toBe(1)
        expect(prGetExisting(meta, dueOther).length).toBe(0)
    })

    it('scopes event_date interval rules to the rule programme stage', () => {
        const meta = metaWith(
            'd2:monthsBetween(V{event_date}, V{enrollment_date}) > 3',
            stage
        )
        const ev = makeVariable({
            type: 'event_date',
            id: 'event_date_stg01',
            stageId: 'stg01',
        })
        const evOther = makeVariable({
            type: 'event_date',
            id: 'event_date_stg02',
            stageId: 'stg02',
        })
        expect(prGetExisting(meta, ev).length).toBe(1)
        expect(prGetExisting(meta, evOther).length).toBe(0)
    })
})
