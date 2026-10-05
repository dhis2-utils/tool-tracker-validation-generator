// Test-only harness: evaluates program-rule conditions with @dhis2/rule-engine,
// the engine the Capture web app, the Android app and the server all use. Lets
// tests assert what a generated condition DOES at data entry (fires or not for
// a given value) instead of what its string looks like.
import {
    RuleActionJs,
    RuleAttributeValue,
    RuleDataValue,
    RuleEngineContextJs,
    RuleEngineJs,
    RuleEnrollmentJs,
    RuleEnrollmentStatus,
    RuleEventJs,
    RuleEventStatus,
    RuleInstant,
    RuleJs,
    RuleLocalDate,
    RuleSupplementaryDataJs,
    RuleValueType,
    RuleVariableJs,
    RuleVariableType,
} from '@dhis2/rule-engine'

export const STAGE = 'stage000001'

export type EngineVariable = {
    /** PRV name, as referenced by #{name} */
    name: string
    source: 'dataElement' | 'attribute'
    valueType: 'DATE' | 'NUMERIC'
    /** data element / attribute id; defaults to the name */
    field?: string
}

export type EngineInput = {
    /** values keyed by PRV name; missing or '' = field left empty */
    values?: Record<string, string | undefined>
    eventDate?: string
    dueDate?: string
    enrollmentDate?: string
    incidentDate?: string
}

const date = (iso: string) => RuleLocalDate.parse(iso)

/** ISO date `offset` days from today (V{current_date} is the real clock). */
export const daysFromToday = (offset: number): string => {
    const d = new Date()
    d.setDate(d.getDate() + offset)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * True when a SHOWERROR rule with `condition` fires for the target event of an
 * enrollment carrying `input`. Throws if the engine cannot evaluate the
 * condition (the engine reports that as an error effect, not as "false").
 */
export function fires(
    condition: string,
    variables: EngineVariable[],
    input: EngineInput = {}
): boolean {
    const values = input.values ?? {}
    const has = (name: string) => (values[name] ?? '') !== ''
    const ruleVariables = variables.map(
        (v) =>
            new RuleVariableJs(
                v.source === 'attribute'
                    ? RuleVariableType.TEI_ATTRIBUTE
                    : RuleVariableType.DATAELEMENT_CURRENT_EVENT,
                v.name,
                false,
                [],
                v.field ?? v.name,
                v.valueType === 'DATE'
                    ? RuleValueType.DATE
                    : RuleValueType.NUMERIC,
                null
            )
    )
    const attributeValues = variables
        .filter((v) => v.source === 'attribute' && has(v.name))
        .map((v) => new RuleAttributeValue(v.field ?? v.name, values[v.name]!))
    const dataValues = variables
        .filter((v) => v.source === 'dataElement' && has(v.name))
        .map((v) => new RuleDataValue(v.field ?? v.name, values[v.name]!))

    const enrollmentDate = input.enrollmentDate ?? daysFromToday(-30)
    const enrollment = new RuleEnrollmentJs(
        'enrollment1',
        'Test programme',
        date(input.incidentDate ?? enrollmentDate),
        date(enrollmentDate),
        RuleEnrollmentStatus.ACTIVE,
        'orgUnit0001',
        null,
        attributeValues
    )
    const event = new RuleEventJs(
        'event000001',
        STAGE,
        'Stage',
        RuleEventStatus.ACTIVE,
        input.eventDate ? date(input.eventDate) : date(daysFromToday(0)),
        RuleInstant.now(),
        null,
        input.dueDate ? date(input.dueDate) : null,
        null,
        'orgUnit0001',
        null,
        dataValues
    )
    const rule = new RuleJs(
        condition,
        [new RuleActionJs(null, 'SHOWERROR', new Map([['content', 'x']]))],
        'rule0000001'
    )
    const context = new RuleEngineContextJs(
        [rule],
        ruleVariables,
        new RuleSupplementaryDataJs([], [], new Map())
    )
    const effects = new RuleEngineJs().evaluateEvent(
        event,
        enrollment,
        [],
        context
    )
    const types = effects.map((e) => e.ruleAction.type)
    if (types.some((t) => t !== 'SHOWERROR')) {
        throw new Error(
            `rule engine could not evaluate "${condition}": ${effects
                .map((e) => `${e.ruleAction.type} ${e.data ?? ''}`)
                .join('; ')}`
        )
    }
    return types.includes('SHOWERROR')
}
