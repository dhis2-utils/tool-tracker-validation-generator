// DHIS2 program rule persistence: PRV management, rule create/update/delete.
// All functions take a data engine (from useDataEngine) plus a *working copy*
// of the program metadata, which they extend with created objects so repeated
// operations in one run (e.g. batch apply) reuse PRVs without refetching.
import {
    generateBetweenDateCondition,
    generateNewRuleCondition,
    generateNumericBetweenCondition,
    generateNumericCondition,
    generateNumericFieldCondition,
} from '@/lib/builder'
import {
    addAppSignature,
    addBatchSignature,
    isBatchGenerated,
} from '@/lib/signature'
import type {
    BatchTemplate,
    ExistingValidation,
    ProgramMetadata,
    ProgramRule,
    ProgramRuleAction,
    ProgramRuleVariable,
    ValidationConfig,
    Variable,
} from '@/lib/types'
import {
    ConfigError,
    getConfigErrors,
    getSuggestedRuleTexts,
    resolveDateComparisonTarget,
    resolveUpperDateComparisonTarget,
} from '@/lib/validation'
import { findVariableByKey } from '@/lib/variables'

/**
 * Structural subset of the app-runtime data engine — `any` parameters keep
 * this assignable from the real engine while letting tests pass simple mocks.
 */
export interface DataEngine {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query(query: any, options?: any): Promise<Record<string, unknown>>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mutate(mutation: any, options?: any): Promise<unknown>
}

export interface ProgramConfig {
    programRulePrefix?: string
    programRuleVariablePrefix?: string
}

export interface RuleServiceContext {
    engine: DataEngine
    /** Working copy of program metadata — mutated with created objects */
    metadata: ProgramMetadata
    programId: string
    config: ProgramConfig | null
    variables: Variable[]
    /**
     * Optional: validate a rule condition against DHIS2 before it is posted,
     * via `POST /api/programRules/condition/description`. Injected by the hook
     * (needs baseUrl + a text/plain body the data engine can't send). When
     * absent (e.g. in unit tests) validation is skipped.
     */
    validateCondition?: (condition: string) => Promise<ConditionCheck>
}

type SignatureFn = (
    name: string,
    description?: string
) => { name: string; description: string }

export async function getUid(engine: DataEngine): Promise<string> {
    const response = (await engine.query({
        ids: { resource: 'system/id' },
    })) as { ids?: { codes?: string[] } }
    const uid = response.ids?.codes?.[0]
    if (!uid) {
        throw new Error('Could not generate a UID')
    }
    return uid
}

export function prvGetSet(
    programMetadata: ProgramMetadata,
    programId: string,
    programRuleVariablePrefix: string | undefined,
    type: 'dataElement' | 'trackedEntityAttribute',
    id: string,
    nameFallback: string,
    valueType = 'DATE'
): ProgramRuleVariable {
    // Reuse an existing PRV only when BOTH the field id AND the source type
    // match what this tool needs (current-event value for data elements, the
    // attribute value for TEAs). Matching on id alone could reuse e.g. a
    // "previous event" PRV and silently evaluate the rule against the wrong
    // value.
    const existing = (programMetadata.programRuleVariables || []).find(
        (prv) =>
            (type === 'dataElement' &&
                prv.dataElement?.id === id &&
                prv.programRuleVariableSourceType ===
                    'DATAELEMENT_CURRENT_EVENT') ||
            (type === 'trackedEntityAttribute' &&
                prv.trackedEntityAttribute?.id === id &&
                prv.programRuleVariableSourceType === 'TEI_ATTRIBUTE')
    )
    if (existing) {
        return existing
    }
    // Format PRV name: [PREFIX]_[NAME], uppercase, underscores, no special chars
    const cleanName = (nameFallback || id)
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
    const name = programRuleVariablePrefix
        ? `${programRuleVariablePrefix}_${cleanName}`
        : cleanName
    return {
        id: null,
        name,
        program: { id: programId },
        programRuleVariableSourceType:
            type === 'dataElement'
                ? 'DATAELEMENT_CURRENT_EVENT'
                : 'TEI_ATTRIBUTE',
        dataElement: type === 'dataElement' ? { id } : undefined,
        trackedEntityAttribute:
            type === 'trackedEntityAttribute' ? { id } : undefined,
        valueType: valueType || 'DATE',
    }
}

function matchesProgramRuleVariable(
    prv: ProgramRuleVariable,
    type: string,
    variable: Variable
): boolean {
    if (!prv) {
        return false
    }
    if (type === 'dataElement') {
        return (
            prv.programRuleVariableSourceType === 'DATAELEMENT_CURRENT_EVENT' &&
            prv.dataElement?.id === variable.id
        )
    }
    if (type === 'trackedEntityAttribute') {
        return (
            prv.programRuleVariableSourceType === 'TEI_ATTRIBUTE' &&
            prv.trackedEntityAttribute?.id === variable.id
        )
    }
    return false
}

interface ErrorReport {
    errorCode?: string
}

/**
 * app-runtime throws FetchError with `details` = the parsed error body.
 * Metadata conflicts surface error reports either at the top level or under
 * `response` depending on the endpoint/version, so check both.
 */
function getConflictErrorReports(error: unknown): ErrorReport[] {
    const details =
        (error as { details?: Record<string, unknown> })?.details ?? {}
    const response = details.response as Record<string, unknown> | undefined
    return (
        (response?.errorReports as ErrorReport[] | undefined) ||
        (details.errorReports as ErrorReport[] | undefined) ||
        []
    )
}

function buildConflictRetryName(
    prvName: string,
    variableId: string | undefined
): string {
    const suffix = (variableId || 'ALT')
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
    return `${prvName}_${suffix}`
}

function cacheProgramRuleVariable(
    programMetadata: ProgramMetadata,
    prv: ProgramRuleVariable
) {
    programMetadata.programRuleVariables =
        programMetadata.programRuleVariables || []
    if (
        !programMetadata.programRuleVariables.some(
            (existing) => existing.id === prv.id
        )
    ) {
        programMetadata.programRuleVariables.push(prv)
    }
}

/** `created` is false when an existing PRV was reused after a name conflict:
 * such a PRV belongs to others and must never be rolled back. */
async function createProgramRuleVariableWithConflictHandling(
    ctx: RuleServiceContext,
    prv: ProgramRuleVariable,
    type: 'dataElement' | 'trackedEntityAttribute',
    variable: Variable,
    allowSuffixRetry = true
): Promise<{ prv: ProgramRuleVariable; created: boolean }> {
    const { engine, metadata, programId } = ctx
    if (!prv.id) {
        prv.id = await getUid(engine)
    }
    try {
        await engine.mutate({
            resource: 'programRuleVariables',
            type: 'create',
            data: prv,
        })
        cacheProgramRuleVariable(metadata, prv)
        return { prv, created: true }
    } catch (error) {
        const hasNameConflict = getConflictErrorReports(error).some(
            (report) => report.errorCode === 'E4051'
        )
        if (!hasNameConflict) {
            throw error
        }
        const response = (await engine.query({
            prvs: {
                resource: 'programRuleVariables',
                params: {
                    filter: [
                        `program.id:eq:${programId}`,
                        `name:eq:${prv.name}`,
                    ],
                    fields: ':owner',
                    paging: false,
                },
            },
        })) as { prvs?: { programRuleVariables?: ProgramRuleVariable[] } }
        const existing = (response.prvs?.programRuleVariables || []).find(
            (candidate) => matchesProgramRuleVariable(candidate, type, variable)
        )
        if (existing) {
            cacheProgramRuleVariable(metadata, existing)
            return { prv: existing, created: false }
        }
        if (!allowSuffixRetry) {
            throw error
        }
        return createProgramRuleVariableWithConflictHandling(
            ctx,
            {
                ...prv,
                id: await getUid(ctx.engine),
                name: buildConflictRetryName(prv.name, variable.id),
            },
            type,
            variable,
            false
        )
    }
}

async function ensurePrv(
    ctx: RuleServiceContext,
    variable: Variable
): Promise<{ prv: ProgramRuleVariable | { name: string }; created: boolean }> {
    if (
        [
            'enrollment',
            'incident',
            'event_date',
            'due_date',
            'current_date',
        ].includes(variable.type)
    ) {
        return {
            prv: { name: variable.prvName || variable.type },
            created: false,
        }
    }
    const type =
        variable.type === 'dataElement'
            ? 'dataElement'
            : ('trackedEntityAttribute' as const)
    const prv = plannedPrv(ctx, variable)
    if (!prv.id) {
        return createProgramRuleVariableWithConflictHandling(
            ctx,
            prv,
            type,
            variable
        )
    }
    return { prv, created: false }
}

export async function ensureProgramRuleVariable(
    ctx: RuleServiceContext,
    variable: Variable
): Promise<ProgramRuleVariable | { name: string }> {
    return (await ensurePrv(ctx, variable)).prv
}

export type ConditionCheck = {
    status: 'valid' | 'invalid' | 'unchecked'
    message?: string
}

/** Readable messages from a failed /api/metadata import (thrown 409 or a
 * 200 whose report is not OK). */
function importErrorMessages(report: unknown): string[] {
    const body = (report ?? {}) as Record<string, unknown>
    const response = (body.response ?? body) as Record<string, unknown>
    const typeReports = (response.typeReports ?? []) as {
        objectReports?: { errorReports?: { message?: string }[] }[]
    }[]
    const messages = typeReports.flatMap((t) =>
        (t.objectReports ?? []).flatMap((o) =>
            (o.errorReports ?? []).map((e) => e.message ?? '')
        )
    )
    const direct = (
        (response.errorReports ?? []) as { message?: string }[]
    ).map((e) => e.message ?? '')
    return [...new Set([...messages, ...direct].filter(Boolean))]
}

/**
 * Write rules and actions in ONE atomic metadata import: DHIS2 stores all of
 * it or none of it (verified on 2.42), so a failure can never leave a rule
 * without its message, or a new condition with an old message.
 */
async function importRuleAndAction(
    engine: DataEngine,
    importStrategy: 'CREATE' | 'UPDATE',
    rule: ProgramRule & { programRuleActions: { id: string }[] },
    action: ProgramRuleAction
): Promise<void> {
    let report: unknown
    try {
        report = await engine.mutate({
            resource: 'metadata',
            type: 'create',
            params: { atomicMode: 'ALL', importStrategy },
            data: { programRules: [rule], programRuleActions: [action] },
        })
    } catch (error) {
        const details = (error as { details?: { httpStatusCode?: number } })
            .details
        const messages = importErrorMessages(details)
        throw Object.assign(
            new Error(
                messages.length
                    ? `Could not save the rule: ${messages.join('; ')}`
                    : (error as Error).message
            ),
            { httpStatusCode: details?.httpStatusCode }
        )
    }
    const body = (report ?? {}) as Record<string, unknown>
    const response = (body.response ?? body) as {
        status?: string
        stats?: { ignored?: number }
    }
    if (response.status === 'ERROR' || (response.stats?.ignored ?? 0) > 0) {
        const messages = importErrorMessages(report)
        throw new Error(
            `Could not save the rule${messages.length ? `: ${messages.join('; ')}` : ''}`
        )
    }
}

const CONFIG_ERROR_MESSAGES: Record<ConfigError, string> = {
    MIN_GREATER_THAN_MAX:
        'The minimum is greater than the maximum, so the rule would reject every value',
    EMPTY_DATE_RANGE:
        'The lower date bound is after the upper bound, so the rule would reject every date',
    INTERVAL_TOO_SMALL: 'The interval must be a whole number of at least 1',
    OFFSET_TOO_SMALL: 'The offset must be a whole number of at least 1 day',
}

const STAGE_BOUND_TYPES = ['dataElement', 'event_date', 'due_date']

const normaliseCondition = (condition: string) =>
    condition.replace(/\s+/g, ' ').trim()

/** The fields a rule reads, with their (planned or created) PRV names. */
interface RuleRefs {
    target: Variable
    lower: Variable | null
    upper: Variable | null
    field: Variable | null
}

function resolveRefs(
    ctx: RuleServiceContext,
    config: ValidationConfig,
    target: Variable
): RuleRefs {
    const { variables } = ctx
    if (target.category === 'numeric') {
        let field: Variable | null = null
        if (
            config.numericOperator !== 'between' &&
            config.numericComparisonType === 'field'
        ) {
            field = findVariableByKey(
                variables,
                config.numericComparisonField ?? ''
            )
            if (!field) {
                throw new Error('Comparison field not found')
            }
        }
        return { target, lower: null, upper: null, field }
    }
    const lower = resolveDateComparisonTarget(config, variables)
    if (!lower) {
        throw new Error('Target date not found')
    }
    let upper: Variable | null = null
    if (config.operator === 'between') {
        upper = resolveUpperDateComparisonTarget(config, variables)
        if (!upper) {
            throw new Error('Upper bound date not found')
        }
    }
    return { target, lower, upper, field: null }
}

const needsPrv = (variable: Variable | null): variable is Variable =>
    Boolean(
        variable &&
        (variable.type === 'dataElement' ||
            variable.type === 'trackedEntityAttribute')
    )

function prvNameFallback(variable: Variable): string {
    return variable.type === 'dataElement' && variable.stageName
        ? `${variable.stageName} ${variable.name || variable.id}`
        : variable.name || variable.id
}

/** Existing PRV for a field, or the one that would be created (id null). */
function plannedPrv(ctx: RuleServiceContext, variable: Variable) {
    return prvGetSet(
        ctx.metadata,
        ctx.programId,
        ctx.config?.programRuleVariablePrefix,
        variable.type === 'dataElement'
            ? 'dataElement'
            : 'trackedEntityAttribute',
        variable.id,
        prvNameFallback(variable),
        variable.valueType
    )
}

function withPrvNames(
    refs: RuleRefs,
    nameFor: (variable: Variable) => string
): RuleRefs {
    const named = (variable: Variable | null) =>
        needsPrv(variable)
            ? { ...variable, prvName: nameFor(variable) }
            : variable
    return {
        target: named(refs.target)!,
        lower: named(refs.lower),
        upper: named(refs.upper),
        field: named(refs.field),
    }
}

function buildCondition(config: ValidationConfig, refs: RuleRefs): string {
    const { target, lower, upper, field } = refs
    if (target.category === 'numeric') {
        if (config.numericOperator === 'between') {
            return generateNumericBetweenCondition(
                target,
                config.numericValue,
                config.numericValueMax
            )
        }
        return field
            ? generateNumericFieldCondition(
                  target,
                  config.numericOperator,
                  field
              )
            : generateNumericCondition(
                  target,
                  config.numericOperator,
                  config.numericValue
              )
    }
    return config.operator === 'between'
        ? generateBetweenDateCondition(target, lower!, upper!)
        : generateNewRuleCondition(target, lower!, config)
}

function stageOf(target: Variable): string | undefined {
    return STAGE_BOUND_TYPES.includes(target.type) ? target.stageId : undefined
}

interface PreparedRule {
    name: string
    description: string
    condition: string
    programStage?: { id: string }
    message: string
    actionType: string
    conditionChecked: boolean
}

/**
 * Everything both create and update need, in a safe order: plan the PRVs and
 * the condition, refuse duplicates / name clashes / impossible configs before
 * writing anything, then create missing PRVs and validate the condition with
 * DHIS2. PRVs created here are removed again if a later step fails
 * (`rollback`), so a refused rule leaves no trace.
 */
async function prepareRule(
    ctx: RuleServiceContext,
    config: ValidationConfig,
    target: Variable,
    signatureFn: SignatureFn,
    validate: boolean,
    excludeRuleId?: string
): Promise<{ prepared: PreparedRule; rollback: () => Promise<void> }> {
    const { metadata, config: programConfig, variables } = ctx
    const errors = getConfigErrors(target, config)
    if (errors.length > 0) {
        throw new Error(CONFIG_ERROR_MESSAGES[errors[0]])
    }
    const refs = resolveRefs(ctx, config, target)
    const stageId = stageOf(target)
    const sameScope = (rule: ProgramRule) =>
        (rule.programStage?.id ?? undefined) === stageId

    const planned = buildCondition(
        config,
        withPrvNames(refs, (v) => plannedPrv(ctx, v).name)
    )
    const duplicate = metadata.programRules.find(
        (rule) =>
            rule.id !== excludeRuleId &&
            sameScope(rule) &&
            normaliseCondition(rule.condition ?? '') ===
                normaliseCondition(planned)
    )
    if (duplicate) {
        throw new Error(`Duplicate rule already exists: "${duplicate.name}"`)
    }

    const suggested = getSuggestedRuleTexts(target, config, variables)
    const prefix = programConfig?.programRulePrefix || ''
    const baseName = config.ruleName || suggested.name
    const name = prefix ? `${prefix} - ${baseName}` : baseName
    const nameClash = metadata.programRules.find(
        (rule) => rule.id !== excludeRuleId && rule.name === name
    )
    if (nameClash) {
        throw new Error(`A program rule named "${name}" already exists`)
    }

    const created: ProgramRuleVariable[] = []
    const rollback = async () => {
        for (const prv of created) {
            try {
                await ctx.engine.mutate({
                    resource: 'programRuleVariables',
                    id: prv.id,
                    type: 'delete',
                })
            } catch {
                // best effort: an unused PRV is harmless and reused next time
            }
            // forget it either way, so later saves in this run recreate it
            // rather than reference a PRV that may be gone
            metadata.programRuleVariables =
                metadata.programRuleVariables.filter((p) => p.id !== prv.id)
        }
        created.length = 0
    }
    try {
        const names = new Map<string, string>()
        for (const variable of [
            refs.target,
            refs.lower,
            refs.upper,
            refs.field,
        ]) {
            if (!needsPrv(variable) || names.has(variable.id)) {
                continue
            }
            const result = await ensurePrv(ctx, variable)
            const prv = result.prv as ProgramRuleVariable
            if (result.created) {
                created.push(prv)
            }
            names.set(variable.id, prv.name)
        }
        const condition = buildCondition(
            config,
            withPrvNames(refs, (v) => names.get(v.id)!)
        )
        let conditionChecked = true
        if (validate && ctx.validateCondition) {
            const check = await ctx.validateCondition(condition)
            if (check.status === 'invalid') {
                throw new Error(
                    `DHIS2 rejected the rule condition${
                        check.message ? `: ${check.message}` : ''
                    }. The rule was not saved (its condition would never evaluate).`
                )
            }
            conditionChecked = check.status === 'valid'
        }
        const { description } = signatureFn(
            name,
            config.ruleDescription || suggested.description
        )
        return {
            prepared: {
                name,
                description,
                condition,
                ...(stageId ? { programStage: { id: stageId } } : {}),
                message: config.ruleMessage || suggested.message,
                actionType: config.actionType || 'SHOWERROR',
                conditionChecked,
            },
            rollback,
        }
    } catch (error) {
        await rollback()
        throw error
    }
}

export interface SaveResult {
    ruleId: string
    /** False when DHIS2 could not be asked to validate the condition. */
    conditionChecked: boolean
}

export async function createValidationForVariable(
    ctx: RuleServiceContext,
    config: ValidationConfig,
    targetVariable: Variable,
    signatureFn: SignatureFn = addAppSignature,
    validate = true
): Promise<SaveResult> {
    const { engine, metadata, programId } = ctx
    const { prepared, rollback } = await prepareRule(
        ctx,
        config,
        targetVariable,
        signatureFn,
        validate
    )
    const [ruleId, actionId] = [await getUid(engine), await getUid(engine)]
    const action: ProgramRuleAction = {
        id: actionId,
        programRule: { id: ruleId },
        programRuleActionType: prepared.actionType,
        content: prepared.message,
        program: { id: programId },
        ...(targetVariable.type === 'dataElement'
            ? { dataElement: { id: targetVariable.id } }
            : targetVariable.type === 'trackedEntityAttribute'
              ? { trackedEntityAttribute: { id: targetVariable.id } }
              : {}),
    }
    const rule = {
        id: ruleId,
        name: prepared.name,
        description: prepared.description,
        condition: prepared.condition,
        program: { id: programId },
        priority: 1,
        ...(prepared.programStage
            ? { programStage: prepared.programStage }
            : {}),
        programRuleActions: [{ id: actionId }],
    }
    try {
        await importRuleAndAction(engine, 'CREATE', rule, action)
    } catch (error) {
        await rollback()
        throw error
    }
    // extend the working copy so later rules in the same run see this one
    metadata.programRules.push(rule)
    metadata.programRuleActions.push(action)
    return { ruleId, conditionChecked: prepared.conditionChecked }
}

type RuleTexts = Pick<ProgramRule, 'name' | 'description' | 'condition'>

const ruleTextPatch = (rule: RuleTexts) => [
    { op: 'replace', path: '/name', value: rule.name },
    { op: 'add', path: '/description', value: rule.description ?? '' },
    { op: 'replace', path: '/condition', value: rule.condition },
]

/**
 * Fallback for a DHIS2 bug (seen on 2.42.6): once a rule has been read, a
 * metadata import updating it together with an action that has no data
 * element / attribute (e.g. an enrollment-date rule) fails with a 500
 * NullPointerException, and so does an action-only import. JSON-patching the
 * two objects works. They are no longer updated atomically, so if the action
 * patch fails the rule is patched back to the copy read just before.
 */
async function patchRuleAndAction(
    engine: DataEngine,
    fresh: RuleTexts,
    rule: ProgramRule,
    action: ProgramRuleAction
): Promise<void> {
    await engine.mutate({
        resource: 'programRules',
        id: rule.id,
        type: 'json-patch',
        data: ruleTextPatch(rule),
    })
    try {
        await engine.mutate({
            resource: 'programRuleActions',
            id: action.id,
            type: 'json-patch',
            data: [
                {
                    op: 'replace',
                    path: '/programRuleActionType',
                    value: action.programRuleActionType,
                },
                { op: 'add', path: '/content', value: action.content ?? '' },
            ],
        })
    } catch (actionError) {
        try {
            await engine.mutate({
                resource: 'programRules',
                id: rule.id,
                type: 'json-patch',
                data: ruleTextPatch(fresh),
            })
        } catch {
            throw new Error(
                `The rule condition was saved but its message could not be (${
                    (actionError as Error).message
                }), and restoring the rule failed. Check "${rule.name}" in the Maintenance app.`
            )
        }
        throw new Error(
            `Could not update the rule message (${
                (actionError as Error).message
            }); the rule was left unchanged.`
        )
    }
}

export interface UpdateValidationInput {
    ruleId: string
    config: ValidationConfig
    currentVariable: Variable
}

type FreshRule = ProgramRule & { programRuleActions?: ProgramRuleAction[] }

export async function updateValidation(
    ctx: RuleServiceContext,
    { ruleId, config, currentVariable }: UpdateValidationInput
): Promise<SaveResult> {
    const { engine, metadata } = ctx
    const cached = metadata.programRules.find((r) => r.id === ruleId)
    if (!cached) {
        throw new Error('Rule not found for updating')
    }
    // Re-read the rule: the page's copy can be minutes old, and writing it
    // back would revert (or delete) what others changed in the meantime.
    const response = (await engine.query({
        rule: {
            resource: 'programRules',
            id: ruleId,
            params: { fields: ':owner,programRuleActions[:owner]' },
        },
    })) as { rule: FreshRule }
    const fresh = response.rule
    if (
        fresh.condition !== cached.condition ||
        fresh.name !== cached.name ||
        (fresh.description ?? '') !== (cached.description ?? '')
    ) {
        throw new Error(
            'This rule was changed since the page was loaded. Reload the page and try again.'
        )
    }
    const freshActions = fresh.programRuleActions ?? []
    const feedback = freshActions.filter((a) =>
        FEEDBACK_ACTION_TYPES.includes(a.programRuleActionType)
    )
    if (feedback.length !== 1) {
        throw new Error(
            feedback.length === 0
                ? 'This rule has no message action to update.'
                : 'This rule has more than one message action; edit it in the Maintenance app.'
        )
    }
    // Keep the rule's app/batch tagging so an edited bulk rule stays a bulk
    // rule (keeps its [DVT-BATCH] tag) instead of reclassifying as individual.
    const signatureFn = isBatchGenerated(fresh)
        ? addBatchSignature
        : addAppSignature
    const { prepared, rollback } = await prepareRule(
        ctx,
        config,
        currentVariable,
        signatureFn,
        true,
        ruleId
    )
    // the rule's full action list, as ids, from the fresh copy
    const rule = {
        ...fresh,
        name: prepared.name,
        description: prepared.description,
        condition: prepared.condition,
        programRuleActions: freshActions.map((a) => ({ id: a.id })),
    }
    const action: ProgramRuleAction = {
        ...feedback[0],
        programRuleActionType:
            config.actionType || feedback[0].programRuleActionType,
        content: prepared.message,
    }
    try {
        try {
            await importRuleAndAction(engine, 'UPDATE', rule, action)
        } catch (error) {
            if ((error as { httpStatusCode?: number }).httpStatusCode !== 500) {
                throw error
            }
            // the import is atomic, so nothing was stored; see patchRuleAndAction
            await patchRuleAndAction(engine, fresh, rule, action)
        }
    } catch (error) {
        await rollback()
        throw error
    }
    // keep the working copy current for later rules in the same run (group
    // edits): their duplicate and name checks must see this rule as it is now
    metadata.programRules = metadata.programRules.map((r) =>
        r.id === ruleId ? rule : r
    )
    metadata.programRuleActions = metadata.programRuleActions.map((a) =>
        a.id === action.id ? action : a
    )
    return { ruleId, conditionChecked: prepared.conditionChecked }
}

const FEEDBACK_ACTION_TYPES = [
    'SHOWWARNING',
    'SHOWERROR',
    'WARNINGONCOMPLETE',
    'ERRORONCOMPLETE',
]

/** Delete a rule. DHIS2 deletes the rule's actions with it (verified on
 * 2.42); deleting them first would leave a rule stripped of its message if
 * the rule delete then failed. PRVs are kept: other rules may use them. */
export async function deleteRule(
    engine: DataEngine,
    validation: ExistingValidation
): Promise<void> {
    await engine.mutate({
        resource: 'programRules',
        id: validation.rule.id,
        type: 'delete',
    })
}

export interface BatchApplyResult {
    createdCount: number
    errors: string[]
    /** Rules saved without DHIS2 having validated their condition. */
    uncheckedCount: number
}

export interface BatchProgress {
    completed: number
    total: number
}

/**
 * Apply queued batch templates to every variable that had no validation when
 * the run started. Targets are computed once up front so a rule created by an
 * earlier template doesn't silently exclude variables from later ones.
 */
export async function applyBatchTemplates(
    ctx: RuleServiceContext,
    templates: BatchTemplate[],
    getTargets: (template: BatchTemplate) => Variable[],
    onProgress?: (progress: BatchProgress) => void
): Promise<BatchApplyResult> {
    let createdCount = 0
    let uncheckedCount = 0
    const errors: string[] = []
    const total = templates.length
    const templateTargets = templates.map((template) => ({
        template,
        // Due dates are generally expected to be in the future; no bulk
        // template is created for them.
        targets: getTargets(template).filter((t) => t.type !== 'due_date'),
    }))

    onProgress?.({ completed: 0, total })

    for (const [index, { template, targets }] of templateTargets.entries()) {
        // Validate with DHIS2 until one rule of this template has been
        // checked; its siblings share the same condition shape.
        let templateChecked = false
        for (const target of targets) {
            try {
                const result = await createValidationForVariable(
                    ctx,
                    template,
                    target,
                    addBatchSignature,
                    !templateChecked
                )
                createdCount++
                if (!result.conditionChecked) {
                    uncheckedCount++
                } else if (ctx.validateCondition) {
                    templateChecked = true
                }
            } catch (error) {
                errors.push(`${target.name}: ${(error as Error).message}`)
            }
        }
        onProgress?.({ completed: index + 1, total })
    }

    return { createdCount, errors, uncheckedCount }
}
