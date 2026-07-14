import { describe, expect, it, vi } from 'vitest'
import { makeMeta, makeVariable } from './helpers'
import type { ProgramRuleVariable } from '@/lib/types'
import {
    createValidationForVariable,
    DataEngine,
    ensureProgramRuleVariable,
    RuleServiceContext,
    updateValidation,
} from '@/services/rules'

const uidEngine = (overrides: Partial<DataEngine> = {}): DataEngine => {
    let uidCounter = 0
    return {
        query: vi.fn(async (query: Record<string, { resource: string }>) => {
            if (query.ids?.resource === 'system/id') {
                uidCounter++
                return {
                    ids: {
                        codes: [`uid${String(uidCounter).padStart(8, '0')}`],
                    },
                }
            }
            return {}
        }),
        mutate: vi.fn(async () => ({})),
        ...overrides,
    }
}

const buildCtx = (engine: DataEngine, prefix = 'TRE'): RuleServiceContext => ({
    engine,
    metadata: makeMeta(),
    programId: 'prog1234567',
    config: { programRuleVariablePrefix: prefix, programRulePrefix: '' },
    variables: [],
})

const conflictError = (nested = false) => {
    const reports = { errorReports: [{ errorCode: 'E4051' }] }
    return Object.assign(new Error('409 Conflict'), {
        details: nested ? { response: reports } : reports,
    })
}

describe('ensureProgramRuleVariable', () => {
    it('stores a newly created PRV in metadata so later calls reuse it', async () => {
        const engine = uidEngine()
        const ctx = buildCtx(engine)
        const variable = makeVariable({
            type: 'dataElement',
            id: 'de123456789',
            name: 'HIV positive date',
            valueType: 'DATE',
        })

        const created = (await ensureProgramRuleVariable(
            ctx,
            variable
        )) as ProgramRuleVariable
        const reused = (await ensureProgramRuleVariable(
            ctx,
            variable
        )) as ProgramRuleVariable

        expect(created.id).toBeTruthy()
        expect(reused.id).toBe(created.id)
        expect(engine.mutate).toHaveBeenCalledTimes(1)
        expect(ctx.metadata.programRuleVariables).toHaveLength(1)
    })

    it('reuses an existing current-event PRV for the same data element', async () => {
        const engine = uidEngine()
        const ctx = buildCtx(engine)
        ctx.metadata.programRuleVariables = [
            {
                id: 'prvCurr0001',
                name: 'EXISTING_CURRENT',
                program: { id: 'prog1234567' },
                programRuleVariableSourceType: 'DATAELEMENT_CURRENT_EVENT',
                dataElement: { id: 'de123456789' },
                valueType: 'NUMBER',
            },
        ]
        const variable = makeVariable({
            type: 'dataElement',
            id: 'de123456789',
            name: 'Age',
            valueType: 'NUMBER',
        })

        const result = (await ensureProgramRuleVariable(
            ctx,
            variable
        )) as ProgramRuleVariable

        expect(result.id).toBe('prvCurr0001')
        expect(engine.mutate).not.toHaveBeenCalled()
    })

    it('does NOT reuse a PRV for the same data element with a different source type', async () => {
        const engine = uidEngine()
        const ctx = buildCtx(engine)
        ctx.metadata.programRuleVariables = [
            {
                id: 'prvPrev0001',
                name: 'EXISTING_PREVIOUS',
                program: { id: 'prog1234567' },
                programRuleVariableSourceType: 'DATAELEMENT_PREVIOUS_EVENT',
                dataElement: { id: 'de123456789' },
                valueType: 'NUMBER',
            },
        ]
        const variable = makeVariable({
            type: 'dataElement',
            id: 'de123456789',
            name: 'Age',
            valueType: 'NUMBER',
        })

        const result = (await ensureProgramRuleVariable(
            ctx,
            variable
        )) as ProgramRuleVariable

        // Must create a fresh current-event PRV rather than reuse the
        // previous-event one (which would evaluate against the wrong value).
        expect(result.id).not.toBe('prvPrev0001')
        expect(result.programRuleVariableSourceType).toBe(
            'DATAELEMENT_CURRENT_EVENT'
        )
        expect(engine.mutate).toHaveBeenCalledTimes(1)
    })

    it('includes stage context in new PRV names for stage data elements', async () => {
        const engine = uidEngine()
        const ctx = buildCtx(engine, 'TB_CS')
        const variable = makeVariable({
            type: 'dataElement',
            id: 'de123456789',
            name: 'Date of culture inoculation liquid media',
            stageName: 'TB Lab',
            valueType: 'DATE',
        })

        await ensureProgramRuleVariable(ctx, variable)

        expect(engine.mutate).toHaveBeenCalledWith(
            expect.objectContaining({
                resource: 'programRuleVariables',
                type: 'create',
                data: expect.objectContaining({
                    name: 'TB_CS_TB_LAB_DATE_OF_CULTURE_INOCULATION_LIQUID_MEDIA',
                }),
            })
        )
    })

    it('returns system variables without creating a PRV', async () => {
        const engine = uidEngine()
        const ctx = buildCtx(engine)
        const variable = makeVariable({
            type: 'enrollment',
            id: 'enrollment_date',
        })

        const result = await ensureProgramRuleVariable(ctx, variable)

        expect(result).toEqual({ name: 'enrollment' })
        expect(engine.mutate).not.toHaveBeenCalled()
    })

    it('reuses an existing PRV from the API when create hits a name conflict', async () => {
        const existing: ProgramRuleVariable = {
            id: 'prvExisting1',
            name: 'MAL_CI_DIAGNOSIS_TREATMENT_TRAVEL_OUTSIDE_COUNTRY_LAST_NIGHT',
            program: { id: 'prog1234567' },
            programRuleVariableSourceType: 'DATAELEMENT_CURRENT_EVENT',
            dataElement: { id: 'de123456789' },
            valueType: 'DATE',
        }
        const engine = uidEngine({
            mutate: vi.fn(async () => {
                throw conflictError()
            }),
        })
        const baseQuery = engine.query
        engine.query = vi.fn(
            async (query: Record<string, { resource: string }>) => {
                if (query.prvs?.resource === 'programRuleVariables') {
                    return { prvs: { programRuleVariables: [existing] } }
                }
                return baseQuery(query)
            }
        )
        const ctx = buildCtx(engine, 'MAL_CI')
        const variable = makeVariable({
            type: 'dataElement',
            id: 'de123456789',
            name: 'Travel outside country last night',
            stageName: 'Diagnosis & Treatment',
            valueType: 'DATE',
        })

        const reused = (await ensureProgramRuleVariable(
            ctx,
            variable
        )) as ProgramRuleVariable

        expect(reused.id).toBe('prvExisting1')
        expect(ctx.metadata.programRuleVariables).toEqual([
            expect.objectContaining({ id: 'prvExisting1' }),
        ])
    })

    it('retries create with a suffixed PRV name when an exact-name conflict cannot be verified', async () => {
        const mutate = vi
            .fn()
            .mockRejectedValueOnce(conflictError(true))
            .mockResolvedValueOnce({})
        const engine = uidEngine({ mutate })
        const baseQuery = engine.query
        engine.query = vi.fn(
            async (query: Record<string, { resource: string }>) => {
                if (query.prvs?.resource === 'programRuleVariables') {
                    // Conflict exists but belongs to a different data element
                    return {
                        prvs: {
                            programRuleVariables: [
                                {
                                    id: 'prvExisting2',
                                    name: 'HFP_HEALTHCARE_SYSTEM_PREPAREDNESS_WHEN_WAS_THE_MOST_RECENT_IPC_ASSESSMENT',
                                },
                            ],
                        },
                    }
                }
                return baseQuery(query)
            }
        )
        const ctx = buildCtx(engine, 'HFP')
        const variable = makeVariable({
            type: 'dataElement',
            id: 'de999999999',
            name: 'When was the most recent IPC assessment',
            stageName: 'Healthcare system preparedness',
            valueType: 'DATE',
        })

        const created = (await ensureProgramRuleVariable(
            ctx,
            variable
        )) as ProgramRuleVariable

        expect(mutate).toHaveBeenCalledTimes(2)
        expect(mutate).toHaveBeenLastCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    name: 'HFP_HEALTHCARE_SYSTEM_PREPAREDNESS_WHEN_WAS_THE_MOST_RECENT_IPC_ASSESSMENT_DE999999999',
                }),
            })
        )
        expect(created.name).toBe(
            'HFP_HEALTHCARE_SYSTEM_PREPAREDNESS_WHEN_WAS_THE_MOST_RECENT_IPC_ASSESSMENT_DE999999999'
        )
        expect(ctx.metadata.programRuleVariables).toEqual([
            expect.objectContaining({ id: created.id }),
        ])
    })
})

describe('condition validation gate', () => {
    it('aborts creation and posts no rule when the validator rejects the condition', async () => {
        const engine = uidEngine()
        const ctx = buildCtx(engine)
        ctx.validateCondition = async () => ({
            valid: false,
            message: "Unknown function or constant: 'd2:addYears'",
        })
        const variable = makeVariable({
            type: 'dataElement',
            id: 'de123456789',
            name: 'Date of birth',
            valueType: 'DATE',
            category: 'date',
        })

        await expect(
            createValidationForVariable(
                ctx,
                {
                    operator: 'before',
                    comparisonDateMode: 'current',
                    ruleName: 'X',
                    ruleMessage: 'm',
                    actionType: 'SHOWERROR',
                },
                variable
            )
        ).rejects.toThrow(/rejected the rule condition/i)

        const ruleCreates = (
            engine.mutate as unknown as {
                mock: { calls: [{ resource: string; type: string }][] }
            }
        ).mock.calls
            .map((c) => c[0])
            .filter((m) => m.resource === 'programRules' && m.type === 'create')
        expect(ruleCreates.length).toBe(0)
    })

    it('creates normally when no validator is injected (unit-test default)', async () => {
        const engine = uidEngine()
        const ctx = buildCtx(engine)
        const variable = makeVariable({
            type: 'enrollment',
            id: 'enrollment_date',
            name: 'Enrollment date',
            category: 'date',
        })
        await expect(
            createValidationForVariable(
                ctx,
                {
                    operator: 'before',
                    comparisonDateMode: 'current',
                    ruleName: 'X',
                    ruleMessage: 'm',
                    actionType: 'SHOWERROR',
                },
                variable
            )
        ).resolves.toBeTruthy()
    })
})

describe('updateValidation — group/bulk edits', () => {
    it('keeps the [DVT-BATCH] tag and regenerates a stage-aware name', async () => {
        const engine = uidEngine()
        const currentVariable = makeVariable({
            type: 'dataElement',
            id: 'de1AAAAAAAA',
            name: 'Vacc date',
            stageName: 'Stage A',
            stageId: 'stgAAAAAAAA',
            valueType: 'DATE',
            category: 'date',
        })
        const ctx: RuleServiceContext = {
            engine,
            programId: 'prog1234567',
            config: { programRuleVariablePrefix: 'TRE', programRulePrefix: '' },
            variables: [currentVariable],
            metadata: makeMeta({
                programRuleVariables: [
                    {
                        id: 'prv1AAAAAAA',
                        name: 'TRE_STAGE_A_VACC_DATE',
                        program: { id: 'prog1234567' },
                        programRuleVariableSourceType:
                            'DATAELEMENT_CURRENT_EVENT',
                        dataElement: { id: 'de1AAAAAAAA' },
                        valueType: 'DATE',
                    },
                ],
                programRules: [
                    {
                        id: 'rule1AAAAAA',
                        name: 'Date validation: Vacc date (Stage A) should be before Current date',
                        description:
                            '[DVT] [DVT-BATCH] Validates that Vacc date is entered before Current date',
                        condition:
                            'd2:hasValue(#{TRE_STAGE_A_VACC_DATE}) && d2:daysBetween(#{TRE_STAGE_A_VACC_DATE}, V{current_date}) < 0',
                        program: { id: 'prog1234567' },
                    },
                ],
                programRuleActions: [
                    {
                        id: 'act1AAAAAAA',
                        programRule: { id: 'rule1AAAAAA' },
                        programRuleActionType: 'SHOWERROR',
                        content: 'old message',
                    },
                ],
            }),
        }

        // A group edit: change "before" → "on or before", no name supplied.
        await updateValidation(ctx, {
            ruleId: 'rule1AAAAAA',
            currentVariable,
            config: {
                operator: 'on_or_before',
                comparisonDateMode: 'current',
                ruleMessage: 'new message',
            },
        })

        const ruleUpdate = (
            engine.mutate as unknown as {
                mock: {
                    calls: [
                        {
                            resource: string
                            type: string
                            data: ProgramRuleVariable & {
                                name: string
                                description: string
                                condition: string
                            }
                        },
                    ][]
                }
            }
        ).mock.calls
            .map((c) => c[0])
            .find((m) => m.resource === 'programRules' && m.type === 'update')

        expect(ruleUpdate?.data.description).toContain('[DVT-BATCH]')
        expect(ruleUpdate?.data.name).toBe(
            'Date validation: Vacc date (Stage A) should be on or before Current date'
        )
        expect(ruleUpdate?.data.condition).toContain('<= 0')
    })
})
