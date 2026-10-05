// Pure functions for building rule expressions and labels
import type { Variable, ValidationConfig } from './types'

export function isSystemVariable(variable?: Variable | null): boolean {
    return [
        'enrollment',
        'incident',
        'event_date',
        'due_date',
        'current_date',
        'fixed_date',
        'relative_current_date',
    ].includes(variable?.type ?? '')
}

export function getVariableReference(variable?: Variable | null): string {
    if (!variable) {
        return ''
    }
    switch (variable.type) {
        case 'enrollment':
            return 'V{enrollment_date}'
        case 'incident':
            return 'V{incident_date}'
        case 'event_date':
            return 'V{event_date}'
        case 'due_date':
            return 'V{due_date}'
        case 'current_date':
            return 'V{current_date}'
        case 'fixed_date':
            return `'${variable.id}'`
        case 'relative_current_date': {
            // Days only: the program-rule engine has d2:addDays but not
            // d2:addYears/d2:addMonths, so those would never evaluate.
            const amount =
                variable.relativeDirection === 'past'
                    ? -Math.abs(variable.relativeAmount ?? 0)
                    : Math.abs(variable.relativeAmount ?? 0)
            return `d2:addDays(V{current_date}, ${amount})`
        }
        case 'dataElement':
        case 'trackedEntityAttribute':
        default:
            return `#{${variable.prvName || variable.name || variable.id}}`
    }
}

const BETWEEN_FN: Record<string, string> = {
    days: 'd2:daysBetween',
    weeks: 'd2:weeksBetween',
    months: 'd2:monthsBetween',
    years: 'd2:yearsBetween',
}

/**
 * "X within N units before/after E", inclusive on both ends: before accepts
 * [E - N units, E], after accepts [E, E + N units]. The condition is the
 * violation (outside the window).
 *
 * d2:*Between counts COMPLETED units, so a plain `*Between(X, E) > N` would
 * accept almost N + 1 units. Shifting X by one day makes the count exact:
 * `*Between(X + 1 day, E) >= N` is "X is earlier than E - N units". Months and
 * years clamp at month end (31 Jan + 1 month = 28 Feb), which needs both
 * one-day shifts for the after-window; for days and weeks the two are
 * equivalent. Verified exhaustively against the rule engine in
 * builder-semantics.test.ts.
 */
export function generateIntervalCondition(
    operator: 'within_before' | 'within_after',
    varRef: string,
    compareRef: string,
    amount: number | null | undefined,
    unit: string | undefined
): string {
    const fn = BETWEEN_FN[unit ?? 'days'] ?? BETWEEN_FN.days
    const n = amount ?? 0
    if (operator === 'within_before') {
        return (
            `${fn}(d2:addDays(${varRef}, 1), ${compareRef}) >= ${n} || ` +
            `d2:daysBetween(${varRef}, ${compareRef}) < 0`
        )
    }
    return (
        `d2:daysBetween(${compareRef}, ${varRef}) < 0 || ` +
        `${fn}(${compareRef}, d2:addDays(${varRef}, -1)) >= ${n} || ` +
        `${fn}(d2:addDays(${compareRef}, 1), ${varRef}) >= ${n}`
    )
}

/** d2:hasValue guards for every data element / attribute the condition reads.
 * An empty number evaluates as 0 in the rule engine, so a comparison against
 * an empty field would otherwise fire. */
function buildGuards(...variables: (Variable | null | undefined)[]): string[] {
    const refs: string[] = []
    for (const variable of variables) {
        if (!variable || isSystemVariable(variable)) {
            continue
        }
        const guard = `d2:hasValue(${getVariableReference(variable)})`
        if (!refs.includes(guard)) {
            refs.push(guard)
        }
    }
    return refs
}

function withGuards(guards: string[], body: string, compound: boolean): string {
    if (guards.length === 0) {
        return body
    }
    return `${guards.join(' && ')} && ${compound ? `(${body})` : body}`
}

// Violation operator for each date comparison: "X before E" is violated when
// X is on or after E, i.e. d2:daysBetween(X, E) = E - X <= 0.
const DATE_VIOLATION_OP: Record<string, string> = {
    before: '<=',
    on_or_before: '<',
    after: '>=',
    on_or_after: '>',
}

export function generateNewRuleCondition(
    variable1: Variable,
    variable2: Variable,
    config: ValidationConfig
): string {
    const var1Ref = getVariableReference(variable1)
    const var2Ref = getVariableReference(variable2)
    const guards = buildGuards(variable1, variable2)
    const operator = config.operator ?? ''

    if (operator === 'within_before' || operator === 'within_after') {
        return withGuards(
            guards,
            generateIntervalCondition(
                operator,
                var1Ref,
                var2Ref,
                config.intervalAmount,
                config.intervalUnit
            ),
            true
        )
    }
    const op = DATE_VIOLATION_OP[operator]
    if (!op) {
        throw new Error(`Unknown operator: ${config.operator}`)
    }
    return withGuards(
        guards,
        `d2:daysBetween(${var1Ref}, ${var2Ref}) ${op} 0`,
        false
    )
}

/**
 * "date between lower and upper" (both inclusive), as a single compound
 * condition. `d2:daysBetween(a, b)` is `b - a`, so `daysBetween(v, lower) <= 0`
 * means `v >= lower` and `daysBetween(v, upper) >= 0` means `v <= upper`.
 */
export function generateBetweenDateCondition(
    variable1: Variable,
    lowerVariable: Variable,
    upperVariable: Variable
): string {
    const varRef = getVariableReference(variable1)
    const lowerRef = getVariableReference(lowerVariable)
    const upperRef = getVariableReference(upperVariable)
    // Error (fire) when the date is OUTSIDE [lower, upper]:
    //   before lower: daysBetween(v, lower) > 0     (lower - v > 0 => v < lower)
    //   after upper:  daysBetween(v, upper) < 0      (upper - v < 0 => v > upper)
    const body =
        `d2:daysBetween(${varRef}, ${lowerRef}) > 0 || ` +
        `d2:daysBetween(${varRef}, ${upperRef}) < 0`
    return withGuards(
        buildGuards(variable1, lowerVariable, upperVariable),
        body,
        true
    )
}

// A SHOWERROR rule fires when its condition is TRUE, so the condition must
// express the VIOLATION — the negation of the user's constraint. e.g. the
// constraint "value must be greater than N" is violated (and the error shown)
// when the value is <= N. (Date operators express the violation naturally via
// d2:daysBetween, so only numeric comparisons need this inversion.)
const NUMERIC_VIOLATION_OP: Record<string, string> = {
    greater_than: '<=',
    greater_than_or_equal: '<',
    less_than: '>=',
    less_than_or_equal: '>',
    equal_to: '!=',
    not_equal_to: '==',
}

export function generateNumericCondition(
    variable: Variable,
    operator: string | undefined,
    value: number | string | null | undefined
): string {
    const varRef = getVariableReference(variable)
    const op = NUMERIC_VIOLATION_OP[operator ?? '']
    if (!op) {
        throw new Error(`Unknown numeric operator: ${operator}`)
    }
    return `d2:hasValue(${varRef}) && ${varRef} ${op} ${value}`
}

export function generateNumericBetweenCondition(
    variable: Variable,
    min: number | string | null | undefined,
    max: number | string | null | undefined
): string {
    const varRef = getVariableReference(variable)
    // Error (fire) when the value is OUTSIDE [min, max].
    return `d2:hasValue(${varRef}) && (${varRef} < ${min} || ${varRef} > ${max})`
}

export function generateNumericFieldCondition(
    variable1: Variable,
    operator: string | undefined,
    variable2: Variable
): string {
    const var1Ref = getVariableReference(variable1)
    const var2Ref = getVariableReference(variable2)
    const op = NUMERIC_VIOLATION_OP[operator ?? '']
    if (!op) {
        throw new Error(`Unknown numeric operator: ${operator}`)
    }
    return withGuards(
        buildGuards(variable1, variable2),
        `${var1Ref} ${op} ${var2Ref}`,
        false
    )
}
