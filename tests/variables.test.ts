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

    it('marks the synthetic type suffix it bakes into a name', () => {
        // The name is "<label> (event date)", so display code needs to know
        // which trailing parenthetical it put there itself — a data element
        // genuinely named "Weight (kg)" must not be treated the same way.
        const vars = buildVariablesArray(mockMeta)
        const ev = vars.find((v) => v.type === 'event_date')
        expect(ev?.name).toBe('Event date (event date)')
        expect(ev?.typeLabel).toBe('event date')
        const enrollment = vars.find((v) => v.type === 'enrollment')
        expect(enrollment?.typeLabel).toBe('enrollment date')
        const de = vars.find((v) => v.id === 'deDate01AAAA')
        expect(de?.typeLabel).toBeUndefined()
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

    describe('event programmes (WITHOUT_REGISTRATION)', () => {
        // An event programme has no real enrollment: DHIS2 creates one hidden
        // enrollment per event. Offering "enrollment date" or "incident date"
        // there would build rules on a date the user never sees, so they are
        // skipped even when the programme carries labels for them.
        const eventMeta = makeMeta({
            programType: 'WITHOUT_REGISTRATION',
            enrollmentDateLabel: 'Registration date',
            displayIncidentDate: true,
            incidentDateLabel: 'Incident date',
            programStages: [
                {
                    id: 'stage001AAAAA',
                    name: 'Stage 1',
                    executionDateLabel: 'Report date',
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
        })

        it('skips enrollment and incident dates', () => {
            const vars = buildVariablesArray(eventMeta)
            expect(vars.find((v) => v.type === 'enrollment')).toBeUndefined()
            expect(vars.find((v) => v.type === 'incident')).toBeUndefined()
        })

        it('still offers the event date, due date and stage data elements', () => {
            const vars = buildVariablesArray(eventMeta)
            expect(vars.find((v) => v.type === 'event_date')?.name).toBe(
                'Report date (event date)'
            )
            expect(vars.find((v) => v.type === 'due_date')).toBeDefined()
            expect(vars.find((v) => v.id === 'deDate01AAAA')).toBeDefined()
        })

        it('keeps enrollment dates for a tracker programme with the same labels', () => {
            const trackerMeta = makeMeta({
                ...eventMeta,
                programType: 'WITH_REGISTRATION',
            })
            const vars = buildVariablesArray(trackerMeta)
            expect(vars.find((v) => v.type === 'enrollment')).toBeDefined()
            expect(vars.find((v) => v.type === 'incident')).toBeDefined()
        })

        it('treats an unspecified programme type as a tracker programme', () => {
            // Absence of programType must not silently drop variables.
            const vars = buildVariablesArray(
                makeMeta({ ...eventMeta, programType: undefined })
            )
            expect(vars.find((v) => v.type === 'enrollment')).toBeDefined()
        })
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

    it('marks future-allowed dates and leaves the default (blocked) unmarked', () => {
        const meta = makeMeta({
            enrollmentDateLabel: 'Registration',
            selectEnrollmentDatesInFuture: true,
            displayIncidentDate: true,
            incidentDateLabel: 'Onset',
            selectIncidentDatesInFuture: false,
            programStages: [
                {
                    id: 'stage001AAAAA',
                    name: 'Stage 1',
                    programStageDataElements: [
                        {
                            allowFutureDate: true,
                            dataElement: {
                                id: 'deFut01AAAAA',
                                name: 'Expiry date',
                                valueType: 'DATE',
                            },
                        },
                        {
                            allowFutureDate: false,
                            dataElement: {
                                id: 'deNoFut01AAA',
                                name: 'Visit date',
                                valueType: 'DATE',
                            },
                        },
                    ],
                },
            ],
            programTrackedEntityAttributes: [
                {
                    allowFutureDate: true,
                    trackedEntityAttribute: {
                        id: 'teaFut01AAAA',
                        name: 'Planned date',
                        valueType: 'DATE',
                    },
                },
            ],
        })
        const vars = buildVariablesArray(meta)
        const find = (id: string) => vars.find((v) => v.id === id)
        expect(find('enrollment_date')?.futureDatesAllowed).toBe(true)
        expect(find('incident_date')?.futureDatesAllowed).toBe(false)
        expect(find('deFut01AAAAA')?.futureDatesAllowed).toBe(true)
        expect(find('deNoFut01AAA')?.futureDatesAllowed).toBe(false)
        expect(find('teaFut01AAAA')?.futureDatesAllowed).toBe(true)
    })

    it('excludes numeric fields bound to an option set', () => {
        const meta = makeMeta({
            programStages: [
                {
                    id: 'stage001AAAAA',
                    name: 'Stage 1',
                    programStageDataElements: [
                        {
                            dataElement: {
                                id: 'deOptNum01AA',
                                name: 'Coded score',
                                valueType: 'INTEGER',
                                optionSet: { id: 'optSet01AAAA' },
                            },
                        },
                    ],
                },
            ],
            programTrackedEntityAttributes: [
                {
                    trackedEntityAttribute: {
                        id: 'teaOptNum01A',
                        name: 'Coded age band',
                        valueType: 'INTEGER_POSITIVE',
                        optionSet: { id: 'optSet02AAAA' },
                    },
                },
            ],
        })
        const vars = buildVariablesArray(meta)
        expect(vars.find((x) => x.id === 'deOptNum01AA')).toBeUndefined()
        expect(vars.find((x) => x.id === 'teaOptNum01A')).toBeUndefined()
    })
})
