// Build the list of trackable variables (dates + numerics) from program metadata
import type { ProgramMetadata, Variable } from './types'

export const NUMERIC_VALUE_TYPES = new Set([
    'INTEGER',
    'INTEGER_POSITIVE',
    'INTEGER_ZERO_OR_POSITIVE',
    'INTEGER_NEGATIVE',
    'NUMBER',
    'PERCENTAGE',
])

/** Human-readable labels for numeric value types, shown in the variable list
 * so admins can see the constraint (e.g. only positive integers) that may
 * influence which validation rules are relevant. */
export const VALUE_TYPE_LABELS: Record<string, string> = {
    INTEGER: 'Integer',
    INTEGER_POSITIVE: 'Positive integer',
    INTEGER_ZERO_OR_POSITIVE: '0 or positive integer',
    INTEGER_NEGATIVE: 'Negative integer',
    NUMBER: 'Number (decimal)',
    PERCENTAGE: 'Percentage',
}

export function buildVariablesArray(
    programMetadata: ProgramMetadata | null
): Variable[] {
    const list: Variable[] = []
    if (!programMetadata) {
        return list
    }

    if (programMetadata.enrollmentDateLabel) {
        list.push({
            id: 'enrollment_date',
            name: `${programMetadata.enrollmentDateLabel} (enrollment date)`,
            type: 'enrollment',
            category: 'date',
            valueType: 'DATE',
            futureDatesAllowed: Boolean(
                programMetadata.selectEnrollmentDatesInFuture
            ),
        })
    }
    if (
        programMetadata.displayIncidentDate &&
        programMetadata.incidentDateLabel
    ) {
        list.push({
            id: 'incident_date',
            name: `${programMetadata.incidentDateLabel} (incident date)`,
            type: 'incident',
            category: 'date',
            valueType: 'DATE',
            futureDatesAllowed: Boolean(
                programMetadata.selectIncidentDatesInFuture
            ),
        })
    }
    list.push({
        id: 'current_date',
        name: 'Current date',
        type: 'current_date',
        category: 'date',
        valueType: 'DATE',
    })

    programMetadata.programStages?.forEach((stage) => {
        const eventLabel = stage.executionDateLabel || 'Event date'
        list.push({
            id: `event_date_${stage.id}`,
            name: `${eventLabel} (event date)`,
            type: 'event_date',
            category: 'date',
            valueType: 'DATE',
            stageId: stage.id,
            stageName: stage.name,
        })
        if (!stage.hideDueDate) {
            list.push({
                id: `due_date_${stage.id}`,
                name: 'Due date',
                type: 'due_date',
                category: 'date',
                valueType: 'DATE',
                stageId: stage.id,
                stageName: stage.name,
            })
        }
        stage.programStageDataElements?.forEach((psde) => {
            const de = psde.dataElement
            if (!de) {
                return
            }
            if (de.valueType === 'DATE') {
                list.push({
                    id: de.id,
                    name: de.name,
                    type: 'dataElement',
                    category: 'date',
                    valueType: 'DATE',
                    stageId: stage.id,
                    stageName: stage.name,
                    futureDatesAllowed: Boolean(psde.allowFutureDate),
                })
            } else if (NUMERIC_VALUE_TYPES.has(de.valueType) && !de.optionSet) {
                // Skip numeric fields bound to an option set: the option set
                // already constrains the accepted values, so a numeric range
                // rule is redundant (and would fight the option list).
                list.push({
                    id: de.id,
                    name: de.name,
                    type: 'dataElement',
                    category: 'numeric',
                    valueType: de.valueType,
                    stageId: stage.id,
                    stageName: stage.name,
                })
            }
        })
    })

    programMetadata.programTrackedEntityAttributes?.forEach((ptea) => {
        const tea = ptea.trackedEntityAttribute
        if (!tea) {
            return
        }
        if (tea.valueType === 'DATE') {
            list.push({
                id: tea.id,
                name: tea.name,
                type: 'trackedEntityAttribute',
                category: 'date',
                valueType: 'DATE',
                futureDatesAllowed: Boolean(ptea.allowFutureDate),
            })
        } else if (NUMERIC_VALUE_TYPES.has(tea.valueType) && !tea.optionSet) {
            // See note above: option-set numerics are excluded.
            list.push({
                id: tea.id,
                name: tea.name,
                type: 'trackedEntityAttribute',
                category: 'numeric',
                valueType: tea.valueType,
            })
        }
    })

    return list
}

export function findVariableByComponents(
    variables: Variable[] | null,
    id: string,
    type: string,
    stageId?: string | null
): Variable | null {
    if (!variables) {
        return null
    }
    return (
        variables.find(
            (v) =>
                v.id === id &&
                v.type === type &&
                (stageId ? v.stageId === stageId : true)
        ) ?? null
    )
}

/** "type:id[:stageId]" key used in selects and URLs */
export function getVariableKey(variable: Variable): string {
    return `${variable.type}:${variable.id}${variable.stageId ? ':' + variable.stageId : ''}`
}

export function findVariableByKey(
    variables: Variable[] | null,
    key: string
): Variable | null {
    if (!key) {
        return null
    }
    const [type, id, stageId] = key.split(':')
    if (!variables) {
        return null
    }
    return (
        variables.find(
            (v) =>
                v.type === type &&
                v.id === id &&
                (v.stageId || '') === (stageId || '')
        ) ?? null
    )
}
