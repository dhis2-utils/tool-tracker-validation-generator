// Which program rules belong to a variable
import { parseRuleCondition } from './parser'
import type {
    ExistingValidation,
    ProgramMetadata,
    ProgramRule,
    ProgramRuleAction,
    Variable,
} from './types'

export const FEEDBACK_ACTION_TYPES = [
    'SHOWWARNING',
    'SHOWERROR',
    'WARNINGONCOMPLETE',
    'ERRORONCOMPLETE',
]

const STAGE_BOUND_TYPES = ['dataElement', 'event_date', 'due_date']

/** A rule without a stage applies in every stage; one with a stage only there. */
function ruleAppliesToStage(rule: ProgramRule, variable: Variable): boolean {
    if (!STAGE_BOUND_TYPES.includes(variable.type)) {
        return true
    }
    return !rule.programStage?.id || rule.programStage.id === variable.stageId
}

function actionsByRule(
    metadata: ProgramMetadata
): Map<string, ProgramRuleAction[]> {
    const map = new Map<string, ProgramRuleAction[]>()
    for (const action of metadata.programRuleActions || []) {
        const ruleId = action.programRule?.id
        if (ruleId) {
            map.set(ruleId, [...(map.get(ruleId) ?? []), action])
        }
    }
    return map
}

/** Rules (with at least one feedback action) and their actions. */
function feedbackRules(metadata: ProgramMetadata): ExistingValidation[] {
    const byRule = actionsByRule(metadata)
    const result: ExistingValidation[] = []
    for (const rule of metadata.programRules || []) {
        const allActions = byRule.get(rule.id) ?? []
        const actions = allActions.filter((a) =>
            FEEDBACK_ACTION_TYPES.includes(a.programRuleActionType)
        )
        if (actions.length > 0 && rule.condition) {
            result.push({ rule, actions, allActions })
        }
    }
    return result
}

function isValidatedBy(
    metadata: ProgramMetadata,
    rule: ProgramRule,
    variable: Variable
): boolean {
    const parsed = parseRuleCondition(
        rule.condition,
        metadata,
        rule.programStage?.id
    )
    const target = parsed?.variable1
    return Boolean(
        target &&
        target.type === variable.type &&
        target.id === variable.id &&
        ruleAppliesToStage(rule, variable)
    )
}

/**
 * Rules that validate `variable`: their condition is exactly one of the app's
 * shapes (see parser.ts) with `variable` as the validated field, in a stage
 * the rule applies to. Rules created by other tools in the same shape count
 * too (they validate the field); whether the app may edit them is decided by
 * the [DVT] tag.
 */
export function prGetExisting(
    programMetadata: ProgramMetadata | null,
    variable: Variable | null
): ExistingValidation[] {
    if (!programMetadata || !variable || variable.type === 'current_date') {
        return []
    }
    return feedbackRules(programMetadata).filter(({ rule }) =>
        isValidatedBy(programMetadata, rule, variable)
    )
}

/**
 * The field `rule` validates, from `variables` (the programme's offered
 * variables), when its condition is one of the app's shapes; otherwise null.
 */
export function validatedVariable(
    metadata: ProgramMetadata,
    rule: ProgramRule,
    variables: Variable[]
): Variable | null {
    return (
        variables.find(
            (variable) =>
                variable.type !== 'current_date' &&
                isValidatedBy(metadata, rule, variable)
        ) ?? null
    )
}

const escapeRegExp = (text: string) =>
    text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function referencePatterns(
    metadata: ProgramMetadata,
    variable: Variable
): RegExp[] {
    switch (variable.type) {
        case 'enrollment':
            return [/V\{enrollment_date\}/]
        case 'incident':
            return [/V\{incident_date\}/]
        case 'event_date':
            return [/V\{event_date\}/]
        case 'due_date':
            return [/V\{due_date\}/]
        case 'dataElement':
        case 'trackedEntityAttribute':
            return (metadata.programRuleVariables || [])
                .filter((prv) =>
                    variable.type === 'dataElement'
                        ? prv.dataElement?.id === variable.id
                        : prv.trackedEntityAttribute?.id === variable.id
                )
                .map((prv) => new RegExp(`[#A]\\{${escapeRegExp(prv.name)}\\}`))
        default:
            return []
    }
}

/**
 * Other rules with feedback actions that read `variable` (through any of its
 * program rule variables, whatever the source type) but don't validate it in
 * one of the app's shapes. Shown read-only, so admins see everything that
 * already reacts to the field.
 */
export function prGetReferencing(
    programMetadata: ProgramMetadata | null,
    variable: Variable | null
): ExistingValidation[] {
    if (!programMetadata || !variable) {
        return []
    }
    const patterns = referencePatterns(programMetadata, variable)
    if (patterns.length === 0) {
        return []
    }
    return feedbackRules(programMetadata).filter(
        ({ rule }) =>
            ruleAppliesToStage(rule, variable) &&
            patterns.some((pattern) => pattern.test(rule.condition)) &&
            !isValidatedBy(programMetadata, rule, variable)
    )
}
