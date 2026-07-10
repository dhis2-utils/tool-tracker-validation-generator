import { describe, expect, it } from 'vitest'
import { makeMeta } from './helpers'
import { buildVariablesArray } from '@/lib/variables'

const mockMeta = makeMeta({
    enrollmentDateLabel: 'Registration date',
    displayIncidentDate: false,
    programStages: [
        {
            id: 'stage001AAAAA',
            name: 'Stage 1',
            executionDateLabel: 'Event date',
            hideDueDate: false,
            programStageDataElements: [
                {
                    dataElement: {
                        id: 'deDate01AAAA',
                        name: 'Date of birth',
                        valueType: 'DATE',
                    },
                },
            ],
        },
    ],
    programTrackedEntityAttributes: [
        {
            trackedEntityAttribute: {
                id: 'teaDate01AAA',
                name: 'DOB',
                valueType: 'DATE',
            },
        },
    ],
})

describe('buildVariablesArray', () => {
    it("event_date id uses 'event_date_' prefix", () => {
        const vars = buildVariablesArray(mockMeta)
        const ev = vars.find((v) => v.type === 'event_date')
        expect(ev?.id).toBe('event_date_stage001AAAAA')
    })

    it("TEA type is 'trackedEntityAttribute'", () => {
        const vars = buildVariablesArray(mockMeta)
        const tea = vars.find((v) => v.id === 'teaDate01AAA')
        expect(tea?.type).toBe('trackedEntityAttribute')
    })

    it("stage data element type is 'dataElement'", () => {
        const vars = buildVariablesArray(mockMeta)
        const de = vars.find((v) => v.id === 'deDate01AAAA')
        expect(de?.type).toBe('dataElement')
    })

    it('due_date added for stages where hideDueDate is false', () => {
        const vars = buildVariablesArray(mockMeta)
        const due = vars.find((v) => v.type === 'due_date')
        expect(due).toBeDefined()
        expect(due?.id).toBe('due_date_stage001AAAAA')
        expect(due?.stageId).toBe('stage001AAAAA')
    })

    it('due_date NOT added for stages where hideDueDate is true', () => {
        const meta = makeMeta({
            ...mockMeta,
            programStages: [
                { ...mockMeta.programStages![0], hideDueDate: true },
            ],
        })
        const vars = buildVariablesArray(meta)
        const due = vars.find((v) => v.type === 'due_date')
        expect(due).toBeUndefined()
    })

    it('returns an empty list without metadata', () => {
        expect(buildVariablesArray(null)).toEqual([])
    })
})

const mockMetaWithNumeric = makeMeta({
    enrollmentDateLabel: 'Registration date',
    displayIncidentDate: false,
    programStages: [
        {
            id: 'stage001AAAAA',
            name: 'Stage 1',
            executionDateLabel: 'Event date',
            hideDueDate: true,
            programStageDataElements: [
                {
                    dataElement: {
                        id: 'deInt01AAAAA',
                        name: 'Age (years)',
                        valueType: 'INTEGER',
                    },
                },
                {
                    dataElement: {
                        id: 'deNum01AAAAA',
                        name: 'Weight (kg)',
                        valueType: 'NUMBER',
                    },
                },
                {
                    dataElement: {
                        id: 'deDate01AAAA',
                        name: 'Date of birth',
                        valueType: 'DATE',
                    },
                },
                {
                    dataElement: {
                        id: 'deTxt01AAAAA',
                        name: 'Notes',
                        valueType: 'TEXT',
                    },
                },
            ],
        },
    ],
    programTrackedEntityAttributes: [
        {
            trackedEntityAttribute: {
                id: 'teaInt01AAAA',
                name: 'Age at registration',
                valueType: 'INTEGER_POSITIVE',
            },
        },
        {
            trackedEntityAttribute: {
                id: 'teaDate01AAA',
                name: 'DOB',
                valueType: 'DATE',
            },
        },
    ],
})

describe('buildVariablesArray — numeric variables', () => {
    it('includes INTEGER data element with category=numeric', () => {
        const vars = buildVariablesArray(mockMetaWithNumeric)
        const v = vars.find((x) => x.id === 'deInt01AAAAA')
        expect(v).toBeDefined()
        expect(v?.category).toBe('numeric')
        expect(v?.valueType).toBe('INTEGER')
    })

    it('includes NUMBER data element with category=numeric', () => {
        const vars = buildVariablesArray(mockMetaWithNumeric)
        const v = vars.find((x) => x.id === 'deNum01AAAAA')
        expect(v?.category).toBe('numeric')
    })

    it('includes INTEGER_POSITIVE TEA with category=numeric', () => {
        const vars = buildVariablesArray(mockMetaWithNumeric)
        const v = vars.find((x) => x.id === 'teaInt01AAAA')
        expect(v).toBeDefined()
        expect(v?.category).toBe('numeric')
        expect(v?.type).toBe('trackedEntityAttribute')
    })

    it('excludes TEXT data elements', () => {
        const vars = buildVariablesArray(mockMetaWithNumeric)
        const v = vars.find((x) => x.id === 'deTxt01AAAAA')
        expect(v).toBeUndefined()
    })

    it('all date variables have category=date and valueType=DATE', () => {
        const vars = buildVariablesArray(mockMetaWithNumeric)
        const dates = vars.filter((x) => x.category === 'date')
        expect(dates.length).toBeGreaterThan(0)
        dates.forEach((v) => expect(v.valueType).toBe('DATE'))
    })
})
