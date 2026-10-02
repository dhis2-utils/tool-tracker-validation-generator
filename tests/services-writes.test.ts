// Metadata writes, asserted on the resulting (fake) server state.
import { describe, expect, it } from 'vitest'
import { fakeServer, FakeServer } from './fakeServer'
import { makeMeta, makeVariable } from './helpers'
import { prGetExisting } from '@/lib/detector'
import type {
    BatchTemplate,
    ProgramMetadata,
    ValidationConfig,
    Variable,
} from '@/lib/types'
import {
    applyBatchTemplates,
    createValidationForVariable,
    deleteRule,
    RuleServiceContext,
    updateValidation,
} from '@/services/rules'

const PROGRAM = 'prog1234567'
const STAGE = 'stage00001A'

const visit = makeVariable({
    type: 'dataElement',
    id: 'deVisit0001',
    name: 'Visit date',
    category: 'date',
    valueType: 'DATE',
    stageId: STAGE,
    stageName: 'Visit',
})
const admission = makeVariable({
    type: 'dataElement',
    id: 'deAdm000001',
    name: 'Admission date',
    category: 'date',
    valueType: 'DATE',
    stageId: STAGE,
    stageName: 'Visit',
})
const weight = makeVariable({
    type: 'dataElement',
    id: 'deWeight001',
    name: 'Weight',
    category: 'numeric',
    valueType: 'NUMBER',
    stageId: STAGE,
    stageName: 'Visit',
})
const enrollment = makeVariable({
    type: 'enrollment',
    id: 'enrollment_date',
    name: 'Enrollment date',
    category: 'date',
})
const variables: Variable[] = [enrollment, visit, admission, weight]

/** The app's view of the server (what useProgramMetadata would load). */
function snapshot(server: FakeServer): ProgramMetadata {
    return makeMeta({
        id: PROGRAM,
        programRules: [...server.rules.values()].map((r) => structuredClone(r)),
        programRuleActions: [...server.actions.values()].map((a) =>
            structuredClone(a)
        ),
        programRuleVariables: [...server.prvs.values()].map((p) =>
            structuredClone(p)
        ),
    })
}

function ctxFor(
    server: FakeServer,
    validate?: RuleServiceContext['validateCondition'],
    programRulePrefix = ''
): RuleServiceContext {
    return {
        engine: server,
        metadata: snapshot(server),
        programId: PROGRAM,
        config: { programRuleVariablePrefix: 'TV', programRulePrefix },
        variables,
        validateCondition: validate,
    }
}

const dateRule = (overrides: ValidationConfig = {}): ValidationConfig => ({
    operator: 'on_or_before',
    comparisonDateMode: 'current',
    actionType: 'SHOWERROR',
    ...overrides,
})

describe('create', () => {
    it('stores the rule and its action together, scoped to the stage', async () => {
        const server = fakeServer()
        await createValidationForVariable(ctxFor(server), dateRule(), visit)
        const [rule] = server.rules.values()
        expect(rule.programStage).toEqual({ id: STAGE })
        expect(rule.condition).toBe(
            'd2:hasValue(#{TV_VISIT_VISIT_DATE}) && d2:daysBetween(#{TV_VISIT_VISIT_DATE}, V{current_date}) < 0'
        )
        const [action] = server.actions.values()
        expect(action.programRule).toEqual({ id: rule.id })
        expect(rule.programRuleActions).toEqual([{ id: action.id }])
        expect(
            server.calls.filter((c) => c.resource === 'metadata')
        ).toHaveLength(1)
        expect(
            server.calls.some(
                (c) =>
                    c.resource === 'programRules' ||
                    c.resource === 'programRuleActions'
            )
        ).toBe(false)
    })

    it('leaves nothing half-written when the import fails', async () => {
        const server = fakeServer()
        server.failNextImports(1, 'Invalid action')
        await expect(
            createValidationForVariable(ctxFor(server), dateRule(), visit)
        ).rejects.toThrow(/Invalid action/)
        expect(server.rules.size).toBe(0)
        expect(server.actions.size).toBe(0)
    })

    it('removes the PRVs it just created when the rule cannot be stored', async () => {
        const server = fakeServer()
        server.failNextImports(1)
        await expect(
            createValidationForVariable(ctxFor(server), dateRule(), visit)
        ).rejects.toThrow()
        expect(server.prvs.size).toBe(0)
    })

    it('removes the PRVs it just created when DHIS2 rejects the condition', async () => {
        const server = fakeServer()
        const validate = async () => ({
            status: 'invalid' as const,
            message: 'Unknown function',
        })
        await expect(
            createValidationForVariable(
                ctxFor(server, validate),
                dateRule(),
                visit
            )
        ).rejects.toThrow(/rejected the rule condition: Unknown function/)
        expect(server.prvs.size).toBe(0)
        expect(server.rules.size).toBe(0)
    })

    it('forgets rolled-back PRVs, so a later save in the same run recreates them', async () => {
        const server = fakeServer()
        const ctx = ctxFor(server)
        const against = (operator: string) => ({
            operator,
            comparisonDateMode: 'variable' as const,
            comparisonDate: `dataElement:deAdm000001:${STAGE}`,
            actionType: 'SHOWERROR',
        })
        server.failNextImports(1)
        await expect(
            createValidationForVariable(ctx, against('before'), visit)
        ).rejects.toThrow()
        await createValidationForVariable(ctx, against('after'), visit)
        const [rule] = server.rules.values()
        const referenced = [...rule.condition.matchAll(/#\{([^}]+)\}/g)].map(
            (m) => m[1]
        )
        const stored = [...server.prvs.values()].map((p) => p.name)
        expect(referenced.every((name) => stored.includes(name))).toBe(true)
    })

    it('never deletes an existing PRV it reused after a name conflict', async () => {
        const server = fakeServer()
        const ctx = ctxFor(server) // snapshot taken before the PRV exists
        server.prvs.set('prvOther001', {
            id: 'prvOther001',
            name: 'TV_VISIT_VISIT_DATE',
            program: { id: PROGRAM },
            programRuleVariableSourceType: 'DATAELEMENT_CURRENT_EVENT',
            dataElement: { id: 'deVisit0001' },
        })
        server.failNextImports(1)
        await expect(
            createValidationForVariable(ctx, dateRule(), visit)
        ).rejects.toThrow()
        expect(server.prvs.has('prvOther001')).toBe(true)
    })

    it('keeps PRVs that already existed', async () => {
        const server = fakeServer()
        await createValidationForVariable(ctxFor(server), dateRule(), visit)
        server.failNextImports(1)
        await expect(
            createValidationForVariable(
                ctxFor(server),
                dateRule({
                    operator: 'after',
                    comparisonDateMode: 'fixed',
                    fixedComparisonDate: '1900-01-01',
                }),
                visit
            )
        ).rejects.toThrow()
        expect(server.prvs.size).toBe(1)
    })

    it('reports when the condition could not be checked', async () => {
        const server = fakeServer()
        const result = await createValidationForVariable(
            ctxFor(server, async () => ({ status: 'unchecked' as const })),
            dateRule(),
            visit
        )
        expect(result.conditionChecked).toBe(false)
        const checked = await createValidationForVariable(
            ctxFor(server, async () => ({ status: 'valid' as const })),
            dateRule({ operator: 'before' }),
            visit
        )
        expect(checked.conditionChecked).toBe(true)
    })

    it('refuses an exact duplicate (same condition in the same stage) before writing anything', async () => {
        const server = fakeServer()
        await createValidationForVariable(ctxFor(server), dateRule(), visit)
        const callsBefore = server.calls.length
        await expect(
            createValidationForVariable(
                ctxFor(server),
                dateRule({ ruleName: 'Other name' }),
                visit
            )
        ).rejects.toThrow(/Duplicate/)
        expect(server.calls.length).toBe(callsBefore)
    })

    it('does not treat a different interval as a duplicate', async () => {
        const server = fakeServer()
        const within = (n: number) => ({
            operator: 'within_before',
            comparisonDateMode: 'variable' as const,
            comparisonDate: `dataElement:deAdm000001:${STAGE}`,
            intervalAmount: n,
            intervalUnit: 'days',
            actionType: 'SHOWERROR',
        })
        await createValidationForVariable(ctxFor(server), within(30), visit)
        await createValidationForVariable(ctxFor(server), within(60), visit)
        expect(server.rules.size).toBe(2)
    })

    it('refuses a name clash under a rule prefix, for dates and numbers', async () => {
        const server = fakeServer()
        await createValidationForVariable(
            ctxFor(server, undefined, 'EIR'),
            dateRule({ ruleName: 'Same' }),
            visit
        )
        await expect(
            createValidationForVariable(
                ctxFor(server, undefined, 'EIR'),
                dateRule({ operator: 'before', ruleName: 'Same' }),
                visit
            )
        ).rejects.toThrow(/"EIR - Same" already exists/)
        await expect(
            createValidationForVariable(
                ctxFor(server, undefined, 'EIR'),
                {
                    numericOperator: 'greater_than',
                    numericComparisonType: 'value',
                    numericValue: 0,
                    ruleName: 'Same',
                },
                weight
            )
        ).rejects.toThrow(/"EIR - Same" already exists/)
    })

    it('refuses a config that would reject every value', async () => {
        const server = fakeServer()
        await expect(
            createValidationForVariable(
                ctxFor(server),
                {
                    numericOperator: 'between',
                    numericComparisonType: 'value',
                    numericValue: 10,
                    numericValueMax: 5,
                },
                weight
            )
        ).rejects.toThrow(/minimum/i)
        expect(server.calls).toEqual([])
    })
})

describe('update', () => {
    async function seeded() {
        const server = fakeServer()
        await createValidationForVariable(ctxFor(server), dateRule(), visit)
        const ctx = ctxFor(server)
        const [validation] = prGetExisting(ctx.metadata, visit)
        return { server, ctx, ruleId: validation.rule.id }
    }

    it('rewrites the condition and message in one atomic import', async () => {
        const { server, ctx, ruleId } = await seeded()
        await updateValidation(ctx, {
            ruleId,
            currentVariable: visit,
            config: dateRule({
                operator: 'before',
                ruleMessage: 'New message',
            }),
        })
        expect(server.rules.get(ruleId)!.condition).toContain(') <= 0')
        expect([...server.actions.values()][0].content).toBe('New message')
        expect(
            server.calls.filter((c) => c.resource === 'metadata')
        ).toHaveLength(2)
    })

    it('keeps an action someone added after the page loaded', async () => {
        const { server, ctx, ruleId } = await seeded()
        // another admin adds an ASSIGN action to the rule
        server.actions.set('assign00001', {
            id: 'assign00001',
            programRule: { id: ruleId },
            programRuleActionType: 'ASSIGN',
            content: 'x',
        })
        server.rules
            .get(ruleId)!
            .programRuleActions!.push({ id: 'assign00001' })
        await updateValidation(ctx, {
            ruleId,
            currentVariable: visit,
            config: dateRule({ operator: 'before' }),
        })
        expect(server.actions.has('assign00001')).toBe(true)
        expect(server.rules.get(ruleId)!.programRuleActions).toContainEqual({
            id: 'assign00001',
        })
    })

    it('refuses to overwrite a rule that was changed since the page loaded', async () => {
        const { server, ctx, ruleId } = await seeded()
        server.rules.get(ruleId)!.condition = 'true'
        await expect(
            updateValidation(ctx, {
                ruleId,
                currentVariable: visit,
                config: dateRule({ operator: 'before' }),
            })
        ).rejects.toThrow(/changed since/)
        expect(server.rules.get(ruleId)!.condition).toBe('true')
    })

    it('refuses a rule with more than one message action', async () => {
        const { server, ruleId } = await seeded()
        server.actions.set('warn0000001', {
            id: 'warn0000001',
            programRule: { id: ruleId },
            programRuleActionType: 'SHOWWARNING',
            content: 'y',
        })
        server.rules
            .get(ruleId)!
            .programRuleActions!.push({ id: 'warn0000001' })
        const fresh = ctxFor(server)
        await expect(
            updateValidation(fresh, {
                ruleId,
                currentVariable: visit,
                config: dateRule({ operator: 'before' }),
            })
        ).rejects.toThrow(/more than one message/)
    })

    it('keeps the [DVT-BATCH] tag of a bulk rule and regenerates its name per stage', async () => {
        const server = fakeServer()
        const followUp = makeVariable({
            type: 'dataElement',
            id: 'deFollow001',
            name: 'Follow-up date',
            category: 'date',
            valueType: 'DATE',
            stageId: 'stage00002B',
            stageName: 'Follow-up',
        })
        const ctx = { ...ctxFor(server), variables: [...variables, followUp] }
        await applyBatchTemplates(
            ctx,
            [
                {
                    category: 'date',
                    scope: 'programme',
                    operator: 'before',
                    comparisonDateMode: 'current',
                    actionType: 'SHOWERROR',
                },
            ],
            () => [visit]
        )
        const editCtx = {
            ...ctxFor(server),
            variables: [...variables, followUp],
        }
        const [validation] = prGetExisting(editCtx.metadata, visit)
        // a group edit: no name supplied, so it is regenerated
        await updateValidation(editCtx, {
            ruleId: validation.rule.id,
            currentVariable: visit,
            config: dateRule({ ruleMessage: 'new message' }),
        })
        const rule = server.rules.get(validation.rule.id)!
        expect(rule.description).toContain('[DVT] [DVT-BATCH]')
        expect(rule.name).toBe(
            'Visit date (Visit) must be on or before Current date'
        )
        expect(rule.condition).toContain(') < 0')
    })

    describe('when DHIS2 cannot update a rule and its message together (2.42 bug)', () => {
        async function seededEnrollmentRule() {
            const server = fakeServer()
            await createValidationForVariable(
                ctxFor(server),
                dateRule(),
                enrollment
            )
            server.simulateFieldlessActionUpdateBug = true
            const ctx = ctxFor(server)
            const [validation] = prGetExisting(ctx.metadata, enrollment)
            return {
                server,
                ctx,
                ruleId: validation.rule.id,
                actionId: validation.actions[0].id,
            }
        }

        it('falls back to patching the rule, then its message', async () => {
            const { server, ctx, ruleId, actionId } =
                await seededEnrollmentRule()
            await updateValidation(ctx, {
                ruleId,
                currentVariable: enrollment,
                config: dateRule({
                    operator: 'before',
                    actionType: 'SHOWWARNING',
                    ruleMessage: 'New',
                }),
            })
            expect(server.rules.get(ruleId)!.condition).toBe(
                'd2:daysBetween(V{enrollment_date}, V{current_date}) <= 0'
            )
            expect(server.rules.get(ruleId)!.name).toBe(
                'Enrollment date must be before Current date'
            )
            expect(server.actions.get(actionId)).toMatchObject({
                programRuleActionType: 'SHOWWARNING',
                content: 'New',
            })
            expect(server.rules.get(ruleId)!.programRuleActions).toEqual([
                { id: actionId },
            ])
        })

        it('restores the rule when its message cannot be patched', async () => {
            const { server, ctx, ruleId, actionId } =
                await seededEnrollmentRule()
            const before = structuredClone(server.rules.get(ruleId))
            const actionBefore = structuredClone(server.actions.get(actionId))
            server.failPatchesOn = 'programRuleActions'
            await expect(
                updateValidation(ctx, {
                    ruleId,
                    currentVariable: enrollment,
                    config: dateRule({
                        operator: 'before',
                        ruleMessage: 'New',
                    }),
                })
            ).rejects.toThrow(/unchanged/)
            expect(server.rules.get(ruleId)).toEqual(before)
            expect(server.actions.get(actionId)).toEqual(actionBefore)
        })
    })

    it('leaves the rule unchanged when the import fails', async () => {
        const { server, ctx, ruleId } = await seeded()
        const before = structuredClone(server.rules.get(ruleId))
        server.failNextImports(1)
        await expect(
            updateValidation(ctx, {
                ruleId,
                currentVariable: visit,
                config: dateRule({ operator: 'before', ruleMessage: 'x' }),
            })
        ).rejects.toThrow()
        expect(server.rules.get(ruleId)).toEqual(before)
    })
})

describe('delete', () => {
    it('deletes the rule (DHIS2 removes its actions with it), nothing else', async () => {
        const server = fakeServer()
        await createValidationForVariable(ctxFor(server), dateRule(), visit)
        const [validation] = prGetExisting(ctxFor(server).metadata, visit)
        await deleteRule(server, validation)
        expect(server.rules.size).toBe(0)
        expect(server.actions.size).toBe(0)
        expect(server.prvs.size).toBe(1)
        expect(server.calls.filter((c) => c.type === 'delete')).toEqual([
            { resource: 'programRules', type: 'delete' },
        ])
    })
})

describe('bulk apply', () => {
    const template = (
        overrides: Partial<BatchTemplate> = {}
    ): BatchTemplate => ({
        category: 'date',
        scope: 'programme',
        operator: 'on_or_before',
        comparisonDateMode: 'current',
        actionType: 'SHOWERROR',
        ...overrides,
    })

    it('keeps validating each template until one rule of it was checked', async () => {
        const server = fakeServer()
        // visit already has the same rule, so its target fails before validation
        await createValidationForVariable(ctxFor(server), dateRule(), visit)
        const checked: string[] = []
        const ctx = ctxFor(server, async (condition) => {
            checked.push(condition)
            return { status: 'valid' as const }
        })
        const result = await applyBatchTemplates(ctx, [template()], () => [
            visit,
            admission,
            enrollment,
        ])
        expect(result.createdCount).toBe(2)
        expect(result.errors).toHaveLength(1)
        expect(checked).toHaveLength(1)
        expect(checked[0]).toContain('TV_VISIT_ADMISSION_DATE')
    })

    it('counts rules whose condition could not be checked', async () => {
        const server = fakeServer()
        const ctx = ctxFor(server, async () => ({
            status: 'unchecked' as const,
        }))
        const result = await applyBatchTemplates(ctx, [template()], () => [
            visit,
            admission,
        ])
        expect(result.uncheckedCount).toBeGreaterThan(0)
    })

    it('never creates a rule for a due date', async () => {
        const server = fakeServer()
        const due = makeVariable({
            type: 'due_date',
            id: `due_date_${STAGE}`,
            name: 'Due date',
            category: 'date',
            stageId: STAGE,
        })
        const result = await applyBatchTemplates(
            ctxFor(server),
            [template()],
            () => [due, visit]
        )
        expect(result.createdCount).toBe(1)
        expect(
            [...server.rules.values()].some((r) =>
                r.condition.includes('V{due_date}')
            )
        ).toBe(false)
    })
})
