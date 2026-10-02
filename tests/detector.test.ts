import { describe, expect, it } from 'vitest'
import { makeMeta, makeVariable } from './helpers'
import { prGetExisting, prGetReferencing } from '@/lib/detector'
import type { ProgramMetadata, ProgramRule } from '@/lib/types'

const ANC = 'stageANC0001'
const PNC = 'stagePNC0001'

const prvs: ProgramMetadata['programRuleVariables'] = [
    {
        id: 'prvVisit001',
        name: 'P_VISIT',
        dataElement: { id: 'deVisit0001' },
        programRuleVariableSourceType: 'DATAELEMENT_CURRENT_EVENT',
    },
    {
        id: 'prvVisitPrv',
        name: 'P_VISIT_PREV',
        dataElement: { id: 'deVisit0001' },
        programRuleVariableSourceType: 'DATAELEMENT_PREVIOUS_EVENT',
    },
    {
        id: 'prvAdm00001',
        name: 'P_ADM',
        dataElement: { id: 'deAdm000001' },
        programRuleVariableSourceType: 'DATAELEMENT_CURRENT_EVENT',
    },
    {
        id: 'prvAge00001',
        name: 'P_AGE',
        trackedEntityAttribute: { id: 'teaAge00001' },
        programRuleVariableSourceType: 'TEI_ATTRIBUTE',
    },
]

const visitIn = (stageId: string) =>
    makeVariable({
        type: 'dataElement',
        id: 'deVisit0001',
        stageId,
        category: 'date',
    })
const admIn = (stageId: string) =>
    makeVariable({
        type: 'dataElement',
        id: 'deAdm000001',
        stageId,
        category: 'date',
    })
const age = makeVariable({
    type: 'trackedEntityAttribute',
    id: 'teaAge00001',
    category: 'numeric',
})
const enrollment = makeVariable({
    type: 'enrollment',
    id: 'enrollment_date',
    category: 'date',
})
const eventDateIn = (stageId: string) =>
    makeVariable({
        type: 'event_date',
        id: `event_date_${stageId}`,
        stageId,
        category: 'date',
    })
const dueDateIn = (stageId: string) =>
    makeVariable({
        type: 'due_date',
        id: `due_date_${stageId}`,
        stageId,
        category: 'date',
    })

function metaWith(
    rules: (Partial<ProgramRule> & { id: string; condition: string })[],
    actionType = 'SHOWERROR'
) {
    return makeMeta({
        programRuleVariables: prvs,
        programRules: rules.map((r) => ({ name: r.id, ...r })),
        programRuleActions: rules.flatMap((r) => [
            {
                id: `${r.id}-act`,
                programRule: { id: r.id },
                programRuleActionType: actionType,
            },
            {
                id: `${r.id}-asg`,
                programRule: { id: r.id },
                programRuleActionType: 'ASSIGN',
            },
        ]),
    })
}

const ids = (list: { rule: { id: string } }[]) => list.map((v) => v.rule.id)

describe('prGetExisting — attributes a rule to the variable it validates', () => {
    it('only in the rule stage when the data element is used in several stages', () => {
        const meta = metaWith([
            {
                id: 'rAnc',
                programStage: { id: ANC },
                condition:
                    'd2:hasValue(#{P_VISIT}) && d2:daysBetween(#{P_VISIT}, V{current_date}) < 0',
            },
            {
                id: 'rPnc',
                programStage: { id: PNC },
                condition:
                    'd2:hasValue(#{P_VISIT}) && d2:daysBetween(#{P_VISIT}, V{current_date}) < 0',
            },
        ])
        expect(ids(prGetExisting(meta, visitIn(ANC)))).toEqual(['rAnc'])
        expect(ids(prGetExisting(meta, visitIn(PNC)))).toEqual(['rPnc'])
    })

    it('to the validated field of a "within" rule, not to the field it compares with', () => {
        const meta = metaWith([
            {
                id: 'rWithin',
                programStage: { id: ANC },
                condition:
                    'd2:hasValue(#{P_VISIT}) && d2:hasValue(#{P_ADM}) && (d2:daysBetween(d2:addDays(#{P_VISIT}, 1), #{P_ADM}) >= 7 || d2:daysBetween(#{P_VISIT}, #{P_ADM}) < 0)',
            },
        ])
        expect(ids(prGetExisting(meta, visitIn(ANC)))).toEqual(['rWithin'])
        expect(prGetExisting(meta, admIn(ANC))).toEqual([])
        expect(ids(prGetReferencing(meta, admIn(ANC)))).toEqual(['rWithin'])
    })

    it('never to a system date it is compared against', () => {
        const meta = metaWith([
            {
                id: 'rWithinEnr',
                programStage: { id: ANC },
                condition:
                    'd2:hasValue(#{P_VISIT}) && (d2:daysBetween(V{enrollment_date}, #{P_VISIT}) < 0 || d2:daysBetween(V{enrollment_date}, d2:addDays(#{P_VISIT}, -1)) >= 30 || d2:daysBetween(d2:addDays(V{enrollment_date}, 1), #{P_VISIT}) >= 30)',
            },
        ])
        expect(ids(prGetExisting(meta, visitIn(ANC)))).toEqual(['rWithinEnr'])
        expect(prGetExisting(meta, enrollment)).toEqual([])
    })

    it('scopes event and due date rules to the rule stage', () => {
        const meta = metaWith([
            {
                id: 'rEv',
                programStage: { id: ANC },
                condition: 'd2:daysBetween(V{event_date}, V{current_date}) < 0',
            },
            {
                id: 'rDue',
                programStage: { id: ANC },
                condition:
                    'd2:daysBetween(V{due_date}, V{enrollment_date}) > 0',
            },
        ])
        expect(ids(prGetExisting(meta, eventDateIn(ANC)))).toEqual(['rEv'])
        expect(prGetExisting(meta, eventDateIn(PNC))).toEqual([])
        expect(ids(prGetExisting(meta, dueDateIn(ANC)))).toEqual(['rDue'])
        expect(prGetExisting(meta, dueDateIn(PNC))).toEqual([])
    })

    it('handles numeric attributes', () => {
        const meta = metaWith([
            {
                id: 'rAge',
                condition:
                    'd2:hasValue(#{P_AGE}) && (#{P_AGE} < 0 || #{P_AGE} > 120)',
            },
        ])
        expect(ids(prGetExisting(meta, age))).toEqual(['rAge'])
    })

    it('ignores rules without a feedback action', () => {
        const meta = metaWith(
            [
                {
                    id: 'rAge',
                    condition: 'd2:hasValue(#{P_AGE}) && #{P_AGE} < 0',
                },
            ],
            'ASSIGN'
        )
        expect(prGetExisting(meta, age)).toEqual([])
    })

    it('keeps only feedback actions in `actions`, all actions in `allActions`', () => {
        const meta = metaWith([
            { id: 'rAge', condition: 'd2:hasValue(#{P_AGE}) && #{P_AGE} < 0' },
        ])
        const [validation] = prGetExisting(meta, age)
        expect(validation.actions.map((a) => a.id)).toEqual(['rAge-act'])
        expect(validation.allActions.map((a) => a.id)).toEqual([
            'rAge-act',
            'rAge-asg',
        ])
    })
})

describe('prGetReferencing — other rules that read the variable', () => {
    it('lists hand-written rules, including ones using another source type', () => {
        const meta = metaWith([
            { id: 'rSum', condition: '#{P_AGE} + 1 > 10' },
            {
                id: 'rPrev',
                programStage: { id: ANC },
                condition: "#{P_VISIT_PREV} > '2020-01-01' && #{P_ADM} == ''",
            },
        ])
        expect(prGetExisting(meta, age)).toEqual([])
        expect(ids(prGetReferencing(meta, age))).toEqual(['rSum'])
        expect(ids(prGetReferencing(meta, visitIn(ANC)))).toEqual(['rPrev'])
        expect(prGetReferencing(meta, visitIn(PNC))).toEqual([])
    })

    it('does not repeat rules that already validate the variable', () => {
        const meta = metaWith([
            { id: 'rAge', condition: 'd2:hasValue(#{P_AGE}) && #{P_AGE} < 0' },
        ])
        expect(prGetReferencing(meta, age)).toEqual([])
    })

    it('does not match a PRV name that merely starts with the same text', () => {
        const meta = metaWith([{ id: 'rAgeX', condition: '#{P_AGE_X} > 1' }])
        expect(prGetReferencing(meta, age)).toEqual([])
    })

    it('lists rules reading a system date', () => {
        const meta = metaWith([
            {
                id: 'rEnr',
                condition:
                    "d2:daysBetween(V{enrollment_date}, '2020-01-01') == 0 || true",
            },
        ])
        expect(ids(prGetReferencing(meta, enrollment))).toEqual(['rEnr'])
    })
})
