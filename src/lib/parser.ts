// Strict reader for the rule conditions this app writes (see builder.ts).
//
// A condition is recognised only if it is EXACTLY one of the builder's shapes:
// the parser finds the shape, resolves its references, regenerates the
// condition with the builder and accepts the result only if it reproduces the
// stored condition. So a parse can never misread a rule, and opening and
// re-saving a rule can never change what it does. Hand-written, edited or
// superseded conditions parse to null and are treated as foreign rules.
import {
    generateBetweenDateCondition,
    generateNewRuleCondition,
    generateNumericBetweenCondition,
    generateNumericCondition,
    generateNumericFieldCondition,
} from './builder'
import type {
    ParsedRuleCondition,
    ProgramMetadata,
    ValidationConfig,
    Variable,
} from './types'

const NUMBER = '-?\\d+(?:\\.\\d+)?(?:e[+-]?\\d+)?'
const NUMBER_RE = new RegExp(`^${NUMBER}$`)

/** Split on a top-level operator, ignoring parentheses and quoted literals. */
function splitTopLevel(text: string, separator: '&&' | '||'): string[] | null {
    const parts: string[] = []
    let depth = 0
    let inQuote = false
    let start = 0
    for (let i = 0; i < text.length; i++) {
        const char = text[i]
        if (char === "'") {
            inQuote = !inQuote
        } else if (!inQuote) {
            if (char === '(') {
                depth++
            } else if (char === ')') {
                depth--
                if (depth < 0) {
                    return null
                }
            } else if (depth === 0 && text.startsWith(separator, i)) {
                parts.push(text.slice(start, i).trim())
                start = i + separator.length
                i += separator.length - 1
            }
        }
    }
    if (depth !== 0 || inQuote) {
        return null
    }
    parts.push(text.slice(start).trim())
    return parts
}

/** Remove one pair of parentheses wrapping the whole expression. */
function unwrap(text: string): string {
    if (!text.startsWith('(') || !text.endsWith(')')) {
        return text
    }
    const inner = text.slice(1, -1)
    return splitTopLevel(inner, '||') ? inner : text
}

interface Call {
    fn: string
    args: string[]
    rest: string
}

/** Parse a leading `d2:fn(arg, …)` call; `rest` is what follows it. */
function parseCall(text: string): Call | null {
    const match = text.match(/^(d2:[A-Za-z]+)\(/)
    if (!match) {
        return null
    }
    let depth = 0
    let inQuote = false
    const args: string[] = []
    let argStart = match[0].length
    for (let i = match[0].length; i < text.length; i++) {
        const char = text[i]
        if (char === "'") {
            inQuote = !inQuote
        } else if (!inQuote) {
            if (char === '(') {
                depth++
            } else if (char === ')') {
                if (depth === 0) {
                    args.push(text.slice(argStart, i).trim())
                    return {
                        fn: match[1],
                        args,
                        rest: text.slice(i + 1).trim(),
                    }
                }
                depth--
            } else if (char === ',' && depth === 0) {
                args.push(text.slice(argStart, i).trim())
                argStart = i + 1
            }
        }
    }
    return null
}

const UNIT_BY_FN: Record<string, string> = {
    'd2:daysBetween': 'days',
    'd2:weeksBetween': 'weeks',
    'd2:monthsBetween': 'months',
    'd2:yearsBetween': 'years',
}

/** `d2:<unit>Between(a, b) <op> <n>` */
function parseBetweenClause(clause: string) {
    const call = parseCall(clause)
    if (!call || !UNIT_BY_FN[call.fn] || call.args.length !== 2) {
        return null
    }
    const cmp = call.rest.match(/^(>=|<=|>|<)\s*(-?\d+)$/)
    if (!cmp) {
        return null
    }
    return {
        unit: UNIT_BY_FN[call.fn],
        a: call.args[0],
        b: call.args[1],
        op: cmp[1],
        n: parseInt(cmp[2], 10),
    }
}

/** `d2:addDays(ref, n)` → ref */
function addDaysTarget(text: string, days: number): string | null {
    const call = parseCall(text)
    return call?.fn === 'd2:addDays' &&
        call.args.length === 2 &&
        call.args[1] === String(days) &&
        call.rest === ''
        ? call.args[0]
        : null
}

const DATE_OP_BY_VIOLATION: Record<string, string> = {
    '<=': 'before',
    '<': 'on_or_before',
    '>=': 'after',
    '>': 'on_or_after',
}

const NUMERIC_OP_BY_VIOLATION: Record<string, string> = {
    '<=': 'greater_than',
    '<': 'greater_than_or_equal',
    '>=': 'less_than',
    '>': 'less_than_or_equal',
    '!=': 'equal_to',
    '==': 'not_equal_to',
}

interface Shape {
    refs: string[]
    config: ParsedRuleCondition['config']
    numeric?: boolean
}

function matchShape(clauses: string[]): Shape | null {
    if (clauses.length === 1) {
        const single = parseBetweenClause(clauses[0])
        if (single) {
            const operator = DATE_OP_BY_VIOLATION[single.op]
            return single.unit === 'days' && single.n === 0 && operator
                ? { refs: [single.a, single.b], config: { operator } }
                : null
        }
        const numeric = clauses[0].match(
            new RegExp(`^(#\\{[^}]+\\})\\s*(>=|<=|>|<|==|!=)\\s*(.+)$`)
        )
        if (!numeric || !NUMERIC_OP_BY_VIOLATION[numeric[2]]) {
            return null
        }
        const operator = NUMERIC_OP_BY_VIOLATION[numeric[2]]
        if (NUMBER_RE.test(numeric[3])) {
            return {
                refs: [numeric[1]],
                numeric: true,
                config: {
                    operator,
                    comparisonType: 'value',
                    value: Number(numeric[3]),
                },
            }
        }
        return /^#\{[^}]+\}$/.test(numeric[3])
            ? {
                  refs: [numeric[1], numeric[3]],
                  numeric: true,
                  config: { operator, comparisonType: 'field' },
              }
            : null
    }

    if (clauses.length === 2) {
        const lo = clauses[0].match(
            new RegExp(`^(#\\{[^}]+\\}) < (${NUMBER})$`)
        )
        const hi = clauses[1].match(
            new RegExp(`^(#\\{[^}]+\\}) > (${NUMBER})$`)
        )
        if (lo && hi) {
            return {
                refs: [lo[1]],
                numeric: true,
                config: {
                    operator: 'between',
                    comparisonType: 'value',
                    value: Number(lo[2]),
                    valueMax: Number(hi[2]),
                },
            }
        }
        const c0 = parseBetweenClause(clauses[0])
        const c1 = parseBetweenClause(clauses[1])
        if (!c0 || !c1) {
            return null
        }
        // date between: daysBetween(X, L) > 0 || daysBetween(X, U) < 0
        if (c0.unit === 'days' && c0.op === '>' && c0.n === 0) {
            return { refs: [c0.a, c0.b, c1.b], config: { operator: 'between' } }
        }
        // within before: fn(addDays(X, 1), E) >= N || daysBetween(X, E) < 0
        const x = addDaysTarget(c0.a, 1)
        return x
            ? {
                  refs: [x, c0.b],
                  config: {
                      operator: 'within_before',
                      intervalAmount: c0.n,
                      intervalUnit: c0.unit,
                  },
              }
            : null
    }

    if (clauses.length === 3) {
        // within after: daysBetween(E, X) < 0 || fn(E, addDays(X, -1)) >= N
        //               || fn(addDays(E, 1), X) >= N
        const c0 = parseBetweenClause(clauses[0])
        const c1 = parseBetweenClause(clauses[1])
        return c0 && c1
            ? {
                  refs: [c0.b, c0.a],
                  config: {
                      operator: 'within_after',
                      intervalAmount: c1.n,
                      intervalUnit: c1.unit,
                  },
              }
            : null
    }
    return null
}

/** Source types the app creates and reuses (see services/rules.ts prvGetSet). */
const APP_PRV_SOURCE_TYPES = ['DATAELEMENT_CURRENT_EVENT', 'TEI_ATTRIBUTE']

function resolveReference(
    ref: string,
    metadata: ProgramMetadata,
    programStageId?: string
): Variable | null {
    if (/^'\d{4}-\d{2}-\d{2}'$/.test(ref)) {
        const date = ref.slice(1, -1)
        return { type: 'fixed_date', id: date, name: date }
    }
    const relative = ref.match(/^d2:addDays\(V\{current_date\}, (-?\d+)\)$/)
    if (relative) {
        const raw = parseInt(relative[1], 10)
        if (raw === 0) {
            return null
        }
        const amount = Math.abs(raw)
        const direction = raw < 0 ? 'past' : 'future'
        return {
            type: 'relative_current_date',
            id: `current_date_${direction}_${amount}_days`,
            name: `${amount} days ${direction === 'past' ? 'before' : 'after'} current date`,
            relativeAmount: amount,
            relativeUnit: 'days',
            relativeDirection: direction,
        }
    }
    switch (ref) {
        case 'V{enrollment_date}':
            return {
                type: 'enrollment',
                id: 'enrollment_date',
                name: 'Enrollment date',
            }
        case 'V{incident_date}':
            return {
                type: 'incident',
                id: 'incident_date',
                name: 'Incident date',
            }
        case 'V{current_date}':
            return {
                type: 'current_date',
                id: 'current_date',
                name: 'Current date',
            }
        case 'V{event_date}':
        case 'V{due_date}': {
            // Only meaningful within the rule's stage; unscoped, the rule
            // would apply to the event / due date of every stage.
            if (!programStageId) {
                return null
            }
            const type = ref === 'V{event_date}' ? 'event_date' : 'due_date'
            return {
                type,
                id: `${type}_${programStageId}`,
                name: type === 'event_date' ? 'Event date' : 'Due date',
                stageId: programStageId,
            }
        }
    }
    const prvRef = ref.match(/^#\{([^}]+)\}$/)
    if (!prvRef) {
        return null
    }
    const prv = (metadata.programRuleVariables || []).find(
        (candidate) => candidate.name === prvRef[1]
    )
    if (
        !prv ||
        !APP_PRV_SOURCE_TYPES.includes(prv.programRuleVariableSourceType ?? '')
    ) {
        return null
    }
    if (prv.dataElement) {
        // A current-event value belongs to the stage being entered, which for
        // app rules is the rule's stage.
        const stageId = prv.programStage?.id ?? programStageId
        return {
            type: 'dataElement',
            id: prv.dataElement.id,
            name: prv.name,
            prvName: prv.name,
            ...(stageId ? { stageId } : {}),
        }
    }
    if (prv.trackedEntityAttribute) {
        return {
            type: 'trackedEntityAttribute',
            id: prv.trackedEntityAttribute.id,
            name: prv.name,
            prvName: prv.name,
        }
    }
    return null
}

const VALIDATED_TYPES = [
    'enrollment',
    'incident',
    'event_date',
    'due_date',
    'dataElement',
    'trackedEntityAttribute',
]

function regenerate(shape: Shape, refs: Variable[]): string {
    const [target, second, third] = refs
    const config = shape.config as ValidationConfig
    if (shape.numeric) {
        if (config.operator === 'between') {
            return generateNumericBetweenCondition(
                target,
                shape.config.value,
                shape.config.valueMax
            )
        }
        return shape.config.comparisonType === 'field'
            ? generateNumericFieldCondition(target, config.operator, second)
            : generateNumericCondition(
                  target,
                  config.operator,
                  shape.config.value
              )
    }
    return config.operator === 'between'
        ? generateBetweenDateCondition(target, second, third)
        : generateNewRuleCondition(target, second, config)
}

const normalise = (text: string) => text.replace(/\s+/g, ' ').trim()

/**
 * Parse a rule condition the app generated. `programStageId` is the rule's
 * programme stage, needed to resolve V{event_date} / V{due_date} and the
 * stage of data elements. Returns null for anything that is not exactly one
 * of the app's condition shapes.
 */
export function parseRuleCondition(
    condition: string,
    metadata: ProgramMetadata,
    programStageId?: string
): ParsedRuleCondition | null {
    const text = normalise(condition ?? '')
    const terms = text ? splitTopLevel(text, '&&') : null
    if (!terms) {
        return null
    }
    let index = 0
    while (index < terms.length - 1 && /^d2:hasValue\(/.test(terms[index])) {
        index++
    }
    if (index !== terms.length - 1) {
        return null
    }
    const clauses = splitTopLevel(unwrap(terms[index]), '||')
    const shape = clauses && matchShape(clauses)
    if (!shape) {
        return null
    }
    const refs = shape.refs.map((ref) =>
        resolveReference(ref, metadata, programStageId)
    )
    if (refs.some((ref) => !ref)) {
        return null
    }
    const resolved = refs as Variable[]
    if (!VALIDATED_TYPES.includes(resolved[0].type)) {
        return null
    }
    let regenerated: string
    try {
        regenerated = regenerate(shape, resolved)
    } catch {
        return null
    }
    if (normalise(regenerated) !== text) {
        return null
    }
    return {
        variable1: resolved[0],
        variable2: resolved[1] ?? null,
        ...(resolved[2] ? { variable3: resolved[2] } : {}),
        config: shape.config,
    }
}
