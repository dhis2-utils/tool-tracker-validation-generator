// Stage- and target-aware rule detection
import {
    isIntervalExpression,
    parseBetweenExpression,
    stripNullGuard,
} from './expression'
import type {
    ExistingValidation,
    ProgramMetadata,
    ProgramRule,
    ProgramRuleVariable,
    Variable,
} from './types'

export const FEEDBACK_ACTION_TYPES = [
    'SHOWWARNING',
    'SHOWERROR',
    'WARNINGONCOMPLETE',
    'ERRORONCOMPLETE',
]

export function prGetExisting(
    programMetadata: ProgramMetadata | null,
    variable: Variable | null
): ExistingValidation[] {
    if (!programMetadata || !variable) {
        return []
    }
    const { type, id } = variable

    const relatedPrvs = (programMetadata.programRuleVariables || []).filter(
        (prv) =>
            (type === 'dataElement' && prv.dataElement?.id === id) ||
            (type === 'trackedEntityAttribute' &&
                prv.trackedEntityAttribute?.id === id)
    )

    const result: ExistingValidation[] = []
    ;(programMetadata.programRules || []).forEach((rule) => {
        const actions = (programMetadata.programRuleActions || []).filter(
            (a) =>
                a.programRule?.id === rule.id &&
                FEEDBACK_ACTION_TYPES.includes(a.programRuleActionType)
        )
        if (!actions.length || !rule.condition) {
            return
        }

        const matches = isVariablePrimaryTarget(
            rule.condition,
            variable,
            relatedPrvs,
            rule
        )

        if (matches) {
            result.push({ rule, actions })
        }
    })

    return result
}

/**
 * Does a single d2:*Between argument reference this variable?
 * Stage-bound system dates (event_date/due_date) only match when the rule is
 * scoped to the variable's own programme stage.
 */
function refMatchesVariable(
    ref: string,
    variable: Variable,
    relatedPrvs: ProgramRuleVariable[],
    rule: ProgramRule
): boolean {
    const { type } = variable
    const cleanRef = ref.trim()

    if (
        type === 'enrollment' &&
        (cleanRef === 'enrollment_date' || cleanRef === 'V{enrollment_date}')
    ) {
        return true
    }
    if (
        type === 'incident' &&
        (cleanRef === 'incident_date' || cleanRef === 'V{incident_date}')
    ) {
        return true
    }
    if (
        type === 'event_date' &&
        (cleanRef === 'event_date' || cleanRef === 'V{event_date}')
    ) {
        // Only match if rule is limited to the same programme stage
        return Boolean(
            variable.stageId && rule?.programStage?.id === variable.stageId
        )
    }
    if (
        type === 'due_date' &&
        (cleanRef === 'due_date' || cleanRef === 'V{due_date}')
    ) {
        return Boolean(
            variable.stageId && rule?.programStage?.id === variable.stageId
        )
    }
    if (
        type === 'current_date' &&
        (cleanRef === 'current_date' || cleanRef === 'V{current_date}')
    ) {
        return true
    }

    // For data elements and attributes, check if the PRV name matches
    // (remove only braces and hash, keep underscores and all other chars)
    if (type === 'dataElement' || type === 'trackedEntityAttribute') {
        const prvName = cleanRef.replace(/[{}#]/g, '')
        return relatedPrvs.some((prv) => prv.name === prvName)
    }

    return false
}

function isVariablePrimaryTarget(
    condition: string,
    variable: Variable,
    relatedPrvs: ProgramRuleVariable[],
    rule: ProgramRule
): boolean {
    const stripped = stripNullGuard(condition)

    const between = parseBetweenExpression(stripped)
    if (between) {
        // Comparison conditions (op against 0) put the validated variable
        // first; interval conditions (within N units before/after) place it
        // as either argument depending on direction — check both so
        // within_before rules stay attributed to the variable they validate.
        const refs = isIntervalExpression(between)
            ? [between.ref1, between.ref2]
            : [between.ref1]
        return refs.some((ref) =>
            refMatchesVariable(ref, variable, relatedPrvs, rule)
        )
    }

    // Parse numeric conditions: #{VAR} OP value  or  #{VAR} OP #{VAR2}
    const numericMatch = stripped.match(/#{([^}]+)}\s*(>=|<=|>|<|==|!=)\s*.+/)
    if (numericMatch) {
        const [, prvName] = numericMatch
        if (
            variable.type === 'dataElement' ||
            variable.type === 'trackedEntityAttribute'
        ) {
            return relatedPrvs.some((prv) => prv.name === prvName)
        }
    }

    return false
}
