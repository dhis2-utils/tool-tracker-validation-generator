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
import { prGetExisting } from '@/lib/detector'
import {
    addAppSignature,
    addBatchSignature,
    findDuplicateRule,
    isBatchGenerated,
    parseRuleCondition,
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
    validateCondition?: (
        condition: string
    ) => Promise<{ valid: boolean; message?: string }>
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

async function createProgramRuleVariableWithConflictHandling(
    ctx: RuleServiceContext,
    prv: ProgramRuleVariable,
    type: 'dataElement' | 'trackedEntityAttribute',
    variable: Variable,
    allowSuffixRetry = true
): Promise<ProgramRuleVariable> {
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
        return prv
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
            return existing
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

export async function ensureProgramRuleVariable(
    ctx: RuleServiceContext,
    variable: Variable
): Promise<ProgramRuleVariable | { name: string }> {
    if (
        [
            'enrollment',
            'incident',
            'event_date',
            'due_date',
            'current_date',
        ].includes(variable.type)
    ) {
        return { name: variable.prvName || variable.type }
    }
    const type =
        variable.type === 'dataElement'
            ? 'dataElement'
            : ('trackedEntityAttribute' as const)
    const nameFallback =
        type === 'dataElement' && variable.stageName
            ? `${variable.stageName} ${variable.name || variable.id}`
            : variable.name || variable.id
    const prv = prvGetSet(
        ctx.metadata,
        ctx.programId,
        ctx.config?.programRuleVariablePrefix,
        type,
        variable.id,
        nameFallback,
        variable.valueType
    )
    if (!prv.id) {
        return createProgramRuleVariableWithConflictHandling(
            ctx,
            prv,
            type,
            variable
        )
    }
    return prv
}

async function createRuleWithActions(
    ctx: RuleServiceContext,
    programRule: Omit<ProgramRule, 'id'>,
    programRuleActions: Omit<ProgramRuleAction, 'id' | 'programRule'>[]
): Promise<ProgramRule> {
    const { engine, metadata } = ctx
    const rule: ProgramRule = { ...programRule, id: await getUid(engine) }
    await engine.mutate({
        resource: 'programRules',
        type: 'create',
        data: rule,
    })
    metadata.programRules = metadata.programRules || []
    metadata.programRules.push(rule)

    for (const pra of programRuleActions) {
        const action: ProgramRuleAction = {
            ...pra,
            id: await getUid(engine),
            programRule: { id: rule.id },
        }
        await engine.mutate({
            resource: 'programRuleActions',
            type: 'create',
            data: action,
        })
        metadata.programRuleActions = metadata.programRuleActions || []
        metadata.programRuleActions.push(action)
    }
    return rule
}

/** Validate a condition against DHIS2 (if the context provides a validator)
 * and throw before posting if the engine would reject it — e.g. an unknown
 * function slipping through. No-op when no validator is injected. */
async function assertConditionValid(
    ctx: RuleServiceContext,
    condition: string
): Promise<void> {
    if (!ctx.validateCondition) {
        return
    }
    const { valid, message } = await ctx.validateCondition(condition)
    if (!valid) {
        throw new Error(
            `DHIS2 rejected the rule condition${
                message ? `: ${message}` : ''
            }. The rule was not created (its condition would never evaluate).`
        )
    }
}

/** Ensure a comparison date variable has a PRV when it needs one (data
 * elements / attributes); system dates and literals are referenced directly. */
async function ensureDateRefPrv(
    ctx: RuleServiceContext,
    variable: Variable
): Promise<Variable> {
    if (['dataElement', 'trackedEntityAttribute'].includes(variable.type)) {
        const prv = await ensureProgramRuleVariable(ctx, variable)
        return { ...variable, prvName: prv.name }
    }
    return variable
}

export async function createDateValidationForVariable(
    ctx: RuleServiceContext,
    config: ValidationConfig,
    targetVariable: Variable,
    signatureFn: SignatureFn = addAppSignature,
    validate = true
): Promise<ProgramRule> {
    const { metadata, programId, config: programConfig, variables } = ctx
    const compareDate = resolveDateComparisonTarget(config, variables)
    if (!compareDate) {
        throw new Error('Target date not found')
    }
    const suggested = getSuggestedRuleTexts(targetVariable, config, variables)

    const duplicateRule = findDuplicateRule(metadata, targetVariable, config)
    if (duplicateRule) {
        throw new Error(
            `Duplicate rule already exists: "${duplicateRule.name}"`
        )
    }

    const finalRuleName = config.ruleName || suggested.name
    const existingRule = metadata.programRules.find(
        (rule) => rule.name === finalRuleName
    )
    if (existingRule) {
        throw new Error(`Rule "${finalRuleName}" already exists`)
    }

    const variable1Prv = await ensureProgramRuleVariable(ctx, targetVariable)
    const targetRef = { ...targetVariable, prvName: variable1Prv.name }

    const prefix = programConfig?.programRulePrefix || ''
    let ruleCondition: string
    if (config.operator === 'between') {
        const upperDate = resolveUpperDateComparisonTarget(config, variables)
        if (!upperDate) {
            throw new Error('Upper bound date not found')
        }
        ruleCondition = generateBetweenDateCondition(
            targetRef,
            await ensureDateRefPrv(ctx, compareDate),
            await ensureDateRefPrv(ctx, upperDate)
        )
    } else {
        ruleCondition = generateNewRuleCondition(
            targetRef,
            await ensureDateRefPrv(ctx, compareDate),
            config
        )
    }
    if (validate) {
        await assertConditionValid(ctx, ruleCondition)
    }

    const ruleName = prefix ? `${prefix} - ${finalRuleName}` : finalRuleName
    const { description } = signatureFn(
        ruleName,
        config.ruleDescription || suggested.description
    )

    const programRule: Omit<ProgramRule, 'id'> = {
        name: ruleName,
        description,
        condition: ruleCondition,
        program: { id: programId },
        priority: 1,
    }
    if (
        (targetVariable.type === 'dataElement' ||
            targetVariable.type === 'event_date' ||
            targetVariable.type === 'due_date') &&
        targetVariable.stageId
    ) {
        programRule.programStage = { id: targetVariable.stageId }
    }

    const programRuleAction: Omit<ProgramRuleAction, 'id' | 'programRule'> = {
        programRuleActionType: config.actionType || 'SHOWERROR',
        content: config.ruleMessage || suggested.message,
        program: { id: programId },
    }
    if (targetVariable.type === 'dataElement') {
        programRuleAction.dataElement = { id: targetVariable.id }
    } else if (targetVariable.type === 'trackedEntityAttribute') {
        programRuleAction.trackedEntityAttribute = { id: targetVariable.id }
    }

    return createRuleWithActions(ctx, programRule, [programRuleAction])
}

export async function createNumericValidationForVariable(
    ctx: RuleServiceContext,
    config: ValidationConfig,
    targetVariable: Variable,
    signatureFn: SignatureFn = addAppSignature,
    validate = true
): Promise<ProgramRule> {
    const { metadata, programId, config: programConfig, variables } = ctx
    let compareField: Variable | null = null
    if (config.numericComparisonType === 'field') {
        compareField = findVariableByKey(
            variables,
            config.numericComparisonField ?? ''
        )
        if (!compareField) {
            throw new Error('Comparison field not found')
        }
    }
    const suggested = getSuggestedRuleTexts(targetVariable, config, variables)

    // Duplicate pre-check (mirrors the date path): same variable, operator
    // and comparison target already covered by an existing rule.
    for (const existing of prGetExisting(metadata, targetVariable)) {
        const parsed = parseRuleCondition(
            existing.rule.condition,
            metadata,
            targetVariable
        )
        if (!parsed || parsed.config.operator !== config.numericOperator) {
            continue
        }
        const sameComparison =
            config.numericComparisonType === 'field'
                ? parsed.config.comparisonType === 'field' &&
                  parsed.variable2?.id === compareField?.id
                : config.numericOperator === 'between'
                  ? parsed.config.value === config.numericValue &&
                    parsed.config.valueMax === config.numericValueMax
                  : parsed.config.comparisonType === 'value' &&
                    parsed.config.value === config.numericValue
        if (sameComparison) {
            throw new Error(
                `Duplicate rule already exists: "${existing.rule.name}"`
            )
        }
    }

    const variable1Prv = await ensureProgramRuleVariable(ctx, targetVariable)
    const variable1WithPrv = { ...targetVariable, prvName: variable1Prv.name }
    let ruleCondition: string
    if (config.numericOperator === 'between') {
        ruleCondition = generateNumericBetweenCondition(
            variable1WithPrv,
            config.numericValue,
            config.numericValueMax
        )
    } else if (config.numericComparisonType === 'field' && compareField) {
        const variable2Prv = await ensureProgramRuleVariable(ctx, compareField)
        ruleCondition = generateNumericFieldCondition(
            variable1WithPrv,
            config.numericOperator,
            {
                ...compareField,
                prvName: variable2Prv.name,
            }
        )
    } else {
        ruleCondition = generateNumericCondition(
            variable1WithPrv,
            config.numericOperator,
            config.numericValue
        )
    }
    if (validate) {
        await assertConditionValid(ctx, ruleCondition)
    }
    const prefix = programConfig?.programRulePrefix || ''
    const ruleNameBase = config.ruleName || suggested.name
    const ruleName = prefix ? `${prefix} - ${ruleNameBase}` : ruleNameBase
    const { description } = signatureFn(
        ruleName,
        config.ruleDescription || suggested.description
    )
    const programRule: Omit<ProgramRule, 'id'> = {
        name: ruleName,
        description,
        condition: ruleCondition,
        program: { id: programId },
        priority: 1,
    }
    if (targetVariable.type === 'dataElement' && targetVariable.stageId) {
        programRule.programStage = { id: targetVariable.stageId }
    }
    const programRuleAction: Omit<ProgramRuleAction, 'id' | 'programRule'> = {
        programRuleActionType: config.actionType || 'SHOWERROR',
        content: config.ruleMessage || suggested.message,
        program: { id: programId },
    }
    if (targetVariable.type === 'dataElement') {
        programRuleAction.dataElement = { id: targetVariable.id }
    } else if (targetVariable.type === 'trackedEntityAttribute') {
        programRuleAction.trackedEntityAttribute = { id: targetVariable.id }
    }
    return createRuleWithActions(ctx, programRule, [programRuleAction])
}

export function createValidationForVariable(
    ctx: RuleServiceContext,
    config: ValidationConfig,
    targetVariable: Variable,
    signatureFn: SignatureFn = addAppSignature,
    validate = true
): Promise<ProgramRule> {
    return targetVariable.category === 'numeric'
        ? createNumericValidationForVariable(
              ctx,
              config,
              targetVariable,
              signatureFn,
              validate
          )
        : createDateValidationForVariable(
              ctx,
              config,
              targetVariable,
              signatureFn,
              validate
          )
}

export interface UpdateValidationInput {
    ruleId: string
    config: ValidationConfig
    currentVariable: Variable
}

const FEEDBACK_ACTION_TYPES = [
    'SHOWWARNING',
    'SHOWERROR',
    'WARNINGONCOMPLETE',
    'ERRORONCOMPLETE',
]

export async function updateValidation(
    ctx: RuleServiceContext,
    { ruleId, config, currentVariable }: UpdateValidationInput
): Promise<void> {
    const { engine, metadata, config: programConfig, variables } = ctx
    const suggested = getSuggestedRuleTexts(currentVariable, config, variables)
    const existingRule = metadata.programRules.find((r) => r.id === ruleId)
    const existingAction = metadata.programRuleActions.find(
        (a) =>
            a.programRule.id === ruleId &&
            FEEDBACK_ACTION_TYPES.includes(a.programRuleActionType)
    )
    if (!existingRule || !existingAction) {
        throw new Error('Rule or action not found for updating')
    }
    // Preserve the rule's app/batch tagging so an edited bulk rule stays a bulk
    // rule (keeps its [DVT-BATCH] tag) instead of reclassifying as individual.
    const signatureFn = isBatchGenerated(existingRule)
        ? addBatchSignature
        : addAppSignature

    let updatedRule: ProgramRule
    if (currentVariable.category === 'numeric') {
        let compareField: Variable | null = null
        if (config.numericComparisonType === 'field') {
            compareField = findVariableByKey(
                variables,
                config.numericComparisonField ?? ''
            )
            if (!compareField) {
                throw new Error('Comparison field not found')
            }
        }
        const variable1Prv = await ensureProgramRuleVariable(
            ctx,
            currentVariable
        )
        const variable1WithPrv = {
            ...currentVariable,
            prvName: variable1Prv.name,
        }
        let ruleCondition: string
        if (config.numericOperator === 'between') {
            ruleCondition = generateNumericBetweenCondition(
                variable1WithPrv,
                config.numericValue,
                config.numericValueMax
            )
        } else if (config.numericComparisonType === 'field' && compareField) {
            const variable2Prv = await ensureProgramRuleVariable(
                ctx,
                compareField
            )
            ruleCondition = generateNumericFieldCondition(
                variable1WithPrv,
                config.numericOperator,
                { ...compareField, prvName: variable2Prv.name }
            )
        } else {
            ruleCondition = generateNumericCondition(
                variable1WithPrv,
                config.numericOperator,
                config.numericValue
            )
        }
        const prefix = programConfig?.programRulePrefix || ''
        // Fall back to a generated name when none is supplied (e.g. group edits
        // that regenerate per variable), mirroring the create path.
        const ruleNameBase = config.ruleName || suggested.name
        const ruleName = prefix ? `${prefix} - ${ruleNameBase}` : ruleNameBase
        const { description } = signatureFn(
            ruleName,
            config.ruleDescription || suggested.description
        )
        updatedRule = {
            ...existingRule,
            name: ruleName,
            description,
            condition: ruleCondition,
        }
    } else {
        const compareDate = resolveDateComparisonTarget(config, variables)
        if (!compareDate) {
            throw new Error('Target date not found')
        }

        // Check for duplicates (excluding the current rule)
        const duplicateRule = findDuplicateRule(
            metadata,
            currentVariable,
            config
        )
        if (duplicateRule && duplicateRule.id !== ruleId) {
            throw new Error(
                `A validation rule comparing these same date variables already exists: "${duplicateRule.name}"`
            )
        }

        const finalRuleName = config.ruleName || suggested.name
        const duplicateName = metadata.programRules.find(
            (rule) => rule.name === finalRuleName && rule.id !== ruleId
        )
        if (duplicateName) {
            throw new Error(
                `A program rule with the name "${finalRuleName}" already exists`
            )
        }

        const variable1Prv = await ensureProgramRuleVariable(
            ctx,
            currentVariable
        )
        const targetRef = { ...currentVariable, prvName: variable1Prv.name }
        let ruleCondition: string
        if (config.operator === 'between') {
            const upperDate = resolveUpperDateComparisonTarget(
                config,
                variables
            )
            if (!upperDate) {
                throw new Error('Upper bound date not found')
            }
            ruleCondition = generateBetweenDateCondition(
                targetRef,
                await ensureDateRefPrv(ctx, compareDate),
                await ensureDateRefPrv(ctx, upperDate)
            )
        } else {
            ruleCondition = generateNewRuleCondition(
                targetRef,
                await ensureDateRefPrv(ctx, compareDate),
                config
            )
        }

        const ruleName = programConfig?.programRulePrefix
            ? `${programConfig.programRulePrefix} - ${finalRuleName}`
            : finalRuleName
        const { description } = signatureFn(
            ruleName,
            config.ruleDescription || suggested.description
        )
        updatedRule = {
            ...existingRule,
            name: ruleName,
            description,
            condition: ruleCondition,
        }
    }

    await assertConditionValid(ctx, updatedRule.condition)

    const updatedAction: ProgramRuleAction = {
        ...existingAction,
        programRuleActionType:
            config.actionType || existingAction.programRuleActionType,
        content: config.ruleMessage || suggested.message,
    }

    await engine.mutate({
        resource: 'programRules',
        id: ruleId,
        type: 'update',
        data: updatedRule,
    })
    await engine.mutate({
        resource: 'programRuleActions',
        id: existingAction.id,
        type: 'update',
        data: updatedAction,
    })
}

export async function deleteRule(
    engine: DataEngine,
    validation: ExistingValidation
): Promise<void> {
    for (const action of validation.actions) {
        try {
            await engine.mutate({
                resource: 'programRuleActions',
                id: action.id,
                type: 'delete',
            })
        } catch (e) {
            // Action may already be gone or removed via cascade — the rule
            // delete below is the authoritative step.
            console.warn('Could not delete action', e)
        }
    }
    await engine.mutate({
        resource: 'programRules',
        id: validation.rule.id,
        type: 'delete',
    })
}

export interface BatchApplyResult {
    createdCount: number
    errors: string[]
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
    const errors: string[] = []
    const total = templates.length
    const templateTargets = templates.map((template) => ({
        template,
        targets: getTargets(template),
    }))

    onProgress?.({ completed: 0, total })

    for (const [index, { template, targets }] of templateTargets.entries()) {
        for (const [targetIndex, target] of targets.entries()) {
            try {
                // Validate the condition once per template (its first rule);
                // sibling rules share the same condition shape.
                await createValidationForVariable(
                    ctx,
                    template,
                    target,
                    addBatchSignature,
                    targetIndex === 0
                )
                createdCount++
            } catch (error) {
                errors.push(`${target.name}: ${(error as Error).message}`)
            }
        }
        onProgress?.({ completed: index + 1, total })
    }

    return { createdCount, errors }
}
