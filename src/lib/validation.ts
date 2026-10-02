// Pure form/validation helpers shared by the details form and batch workspace
import { prGetExisting } from './detector'
import { removeAllSignatures } from './signature'
import type {
    BatchTemplate,
    ComparisonDateMode,
    ParsedRuleCondition,
    ProgramMetadata,
    ProgramRule,
    ProgramRuleAction,
    RelativeDirection,
    ValidationConfig,
    Variable,
    VariableCategory,
} from './types'
import { findVariableByKey, getVariableKey } from './variables'

export const DATE_OPERATOR_LABELS: Record<string, string> = {
    before: 'before',
    after: 'after',
    on_or_after: 'on or after',
    on_or_before: 'on or before',
    within_before: 'within',
    within_after: 'within',
    between: 'between',
}

export const NUMERIC_OPERATOR_LABELS: Record<string, string> = {
    greater_than: 'greater than',
    greater_than_or_equal: 'greater than or equal to',
    less_than: 'less than',
    less_than_or_equal: 'less than or equal to',
    equal_to: 'equal to',
    not_equal_to: 'not equal to',
    between: 'between',
}

export function buildRelativeDateTarget(
    amount: number | string | null | undefined,
    unit?: string,
    direction?: RelativeDirection | string
): Variable | null {
    const normalizedAmount = Math.abs(parseInt(String(amount), 10))
    if (!normalizedAmount) {
        return null
    }
    const normalizedUnit = unit || 'days'
    const normalizedDirection: RelativeDirection =
        direction === 'future' ? 'future' : 'past'
    return {
        type: 'relative_current_date',
        id: `current_date_${normalizedDirection}_${normalizedAmount}_${normalizedUnit}`,
        name: `${formatInterval(normalizedAmount, normalizedUnit)} ${
            normalizedDirection === 'past' ? 'before' : 'after'
        } current date`,
        relativeAmount: normalizedAmount,
        relativeUnit: normalizedUnit,
        relativeDirection: normalizedDirection,
    }
}

interface DateTargetFields {
    mode?: ComparisonDateMode
    comparisonDate?: string
    fixedComparisonDate?: string
    relativeAmount?: number | null
    relativeUnit?: string
    relativeDirection?: RelativeDirection
}

function resolveDateTarget(
    fields: DateTargetFields,
    variables: Variable[] | null
): Variable | null {
    const comparisonMode = fields.mode || 'variable'
    if (comparisonMode === 'fixed') {
        if (!fields.fixedComparisonDate) {
            return null
        }
        return {
            type: 'fixed_date',
            id: fields.fixedComparisonDate,
            name: fields.fixedComparisonDate,
        }
    }
    if (comparisonMode === 'current') {
        return {
            type: 'current_date',
            id: 'current_date',
            name: 'Current date',
        }
    }
    if (comparisonMode === 'relative') {
        return buildRelativeDateTarget(
            fields.relativeAmount,
            fields.relativeUnit,
            fields.relativeDirection
        )
    }
    if (!fields.comparisonDate) {
        return null
    }
    return findVariableByKey(variables, fields.comparisonDate)
}

export function resolveDateComparisonTarget(
    config: ValidationConfig,
    variables: Variable[] | null
): Variable | null {
    return resolveDateTarget(
        {
            mode: config.comparisonDateMode,
            comparisonDate: config.comparisonDate,
            fixedComparisonDate: config.fixedComparisonDate,
            relativeAmount: config.relativeComparisonAmount,
            relativeUnit: config.relativeComparisonUnit,
            relativeDirection: config.relativeComparisonDirection,
        },
        variables
    )
}

/** Resolve the upper bound of a date "between" rule. */
export function resolveUpperDateComparisonTarget(
    config: ValidationConfig,
    variables: Variable[] | null
): Variable | null {
    return resolveDateTarget(
        {
            mode: config.upperComparisonDateMode,
            comparisonDate: config.upperComparisonDate,
            fixedComparisonDate: config.upperFixedComparisonDate,
            relativeAmount: config.upperRelativeComparisonAmount,
            relativeUnit: config.upperRelativeComparisonUnit,
            relativeDirection: config.upperRelativeComparisonDirection,
        },
        variables
    )
}

/**
 * The comparison variables that make sense for a given validated variable:
 * enrollment-level dates compare with other enrollment-level dates; stage
 * variables also compare with dates in the same stage.
 */
export function getDateComparisonOptions(
    currentVariable: Variable,
    variables: Variable[]
): Variable[] {
    return variables.filter((variable) => {
        if (variable.category !== 'date') {
            return false
        }
        // Skip if this is the same variable as the one being validated
        if (
            variable.id === currentVariable.id &&
            variable.type === currentVariable.type &&
            variable.stageId === currentVariable.stageId
        ) {
            return false
        }
        if (currentVariable.type === 'enrollment') {
            return (
                variable.type === 'incident' ||
                variable.type === 'trackedEntityAttribute'
            )
        }
        if (currentVariable.type === 'incident') {
            return (
                variable.type === 'enrollment' ||
                variable.type === 'trackedEntityAttribute'
            )
        }
        if (currentVariable.type === 'trackedEntityAttribute') {
            return (
                variable.type === 'enrollment' || variable.type === 'incident'
            )
        }
        if (currentVariable.type === 'event_date') {
            if (
                ['enrollment', 'incident', 'trackedEntityAttribute'].includes(
                    variable.type
                )
            ) {
                return true
            }
            if (variable.type === 'dataElement') {
                return variable.stageId === currentVariable.stageId
            }
            return false
        }
        if (currentVariable.type === 'dataElement') {
            if (
                ['enrollment', 'incident', 'trackedEntityAttribute'].includes(
                    variable.type
                )
            ) {
                return true
            }
            if (
                variable.type === 'event_date' ||
                variable.type === 'dataElement'
            ) {
                return variable.stageId === currentVariable.stageId
            }
            return false
        }
        if (currentVariable.type === 'current_date') {
            return true
        }
        return false
    })
}

/** Numeric fields the current numeric variable can be compared against */
export function getNumericFieldOptions(
    currentVariable: Variable,
    variables: Variable[]
): Variable[] {
    return variables.filter((v) => {
        if (v.category !== 'numeric') {
            return false
        }
        if (
            v.id === currentVariable.id &&
            v.stageId === currentVariable.stageId
        ) {
            return false
        }
        // Scope: same stage data elements + numeric TEAs
        if (v.type === 'trackedEntityAttribute') {
            return true
        }
        if (v.type === 'dataElement') {
            return v.stageId === currentVariable.stageId
        }
        return false
    })
}

export function getUnvalidatedVariables(
    programMetadata: ProgramMetadata,
    variables: Variable[],
    category: VariableCategory,
    stageId: string | null,
    excludeVariable: Variable | null = null
): Variable[] {
    return (variables || []).filter((v) => {
        if (v.category !== category) {
            return false
        }
        // "Current date" is a comparison-only pseudo-variable — rules cannot
        // meaningfully validate it.
        if (v.type === 'current_date') {
            return false
        }
        // Due dates are generally expected to be in the future (but not
        // always), so no bulk template fits them; validate them individually.
        if (v.type === 'due_date') {
            return false
        }
        if (
            excludeVariable &&
            v.id === excludeVariable.id &&
            v.type === excludeVariable.type &&
            v.stageId === excludeVariable.stageId
        ) {
            return false
        }
        if (stageId !== null && v.stageId !== stageId) {
            return false
        }
        const existing = prGetExisting(programMetadata, v)
        return existing.length === 0
    })
}

export interface PreviewTexts {
    preview: string
    suggestedRuleName: string
    suggestedMessage: string
    suggestedDescription: string
}

const EMPTY_PREVIEW: PreviewTexts = {
    preview: '',
    suggestedRuleName: '',
    suggestedMessage: '',
    suggestedDescription: '',
}

function dateTargetLabel(
    fields: DateTargetFields,
    variables: Variable[] | null
): string {
    const mode = fields.mode || 'variable'
    if (mode === 'fixed') {
        return fields.fixedComparisonDate || ''
    }
    if (mode === 'current') {
        return 'Current date'
    }
    if (mode === 'relative') {
        const amount = fields.relativeAmount
        const unit = fields.relativeUnit || 'days'
        const direction = fields.relativeDirection || 'past'
        return amount
            ? `${formatInterval(amount, unit)} ${direction === 'past' ? 'before' : 'after'} current date`
            : ''
    }
    if (!fields.comparisonDate) {
        return ''
    }
    return findVariableByKey(variables, fields.comparisonDate)?.name ?? ''
}

export function getDateComparisonLabel(
    config: ValidationConfig,
    variables: Variable[] | null
): string {
    return dateTargetLabel(
        {
            mode: config.comparisonDateMode,
            comparisonDate: config.comparisonDate,
            fixedComparisonDate: config.fixedComparisonDate,
            relativeAmount: config.relativeComparisonAmount,
            relativeUnit: config.relativeComparisonUnit,
            relativeDirection: config.relativeComparisonDirection,
        },
        variables
    )
}

export function getUpperDateComparisonLabel(
    config: ValidationConfig,
    variables: Variable[] | null
): string {
    return dateTargetLabel(
        {
            mode: config.upperComparisonDateMode,
            comparisonDate: config.upperComparisonDate,
            fixedComparisonDate: config.upperFixedComparisonDate,
            relativeAmount: config.upperRelativeComparisonAmount,
            relativeUnit: config.upperRelativeComparisonUnit,
            relativeDirection: config.upperRelativeComparisonDirection,
        },
        variables
    )
}

const STAGE_SCOPED_TYPES = ['dataElement', 'event_date', 'due_date']

/** Action types whose message renders away from the field it belongs to, so the
 * text has to name the field itself. The inline types render next to the field,
 * where repeating its name is noise. */
const ON_COMPLETE_ACTION_TYPES = ['ERRORONCOMPLETE', 'WARNINGONCOMPLETE']

/**
 * True when the stage is worth naming: the variable is stage-bound, and the
 * programme has more than one stage to tell apart. `stageCount` omitted means
 * "unknown" and keeps the stage, since dropping it can make names collide.
 */
function shouldNameStage(variable: Variable, stageCount?: number): boolean {
    return (
        Boolean(variable.stageName) &&
        STAGE_SCOPED_TYPES.includes(variable.type) &&
        stageCount !== 1
    )
}

/** Number of distinct stages the variable list covers. `buildVariablesArray`
 * emits an event-date variable for every stage, so this matches the
 * programme's stage count. */
function countStages(variables: Variable[] | null): number | undefined {
    if (!variables) {
        return undefined
    }
    const stageIds = new Set<string>()
    for (const variable of variables) {
        if (variable.stageId) {
            stageIds.add(variable.stageId)
        }
    }
    return stageIds.size
}

export function getVariableDisplayName(
    variable: Variable,
    stageCount?: number
): string {
    if (!shouldNameStage(variable, stageCount)) {
        return variable.name
    }
    // Fold the stage into the marker we appended ourselves rather than adding a
    // second parenthetical: "Report date (Specimen Tracking event date)", not
    // "Report date (event date) (Specimen Tracking)".
    if (variable.typeLabel) {
        const marker = ` (${variable.typeLabel})`
        if (variable.name.endsWith(marker)) {
            const label = variable.name.slice(0, -marker.length)
            return `${label} (${variable.stageName} ${variable.typeLabel})`
        }
    }
    return `${variable.name} (${variable.stageName})`
}

/** Prose clause naming the variable's stage, for the description. Empty when
 * the stage is not worth naming. */
function stageClause(variable: Variable, stageCount?: number): string {
    return shouldNameStage(variable, stageCount)
        ? ` in the ${variable.stageName} stage`
        : ''
}

/** Opening of the validation message: on-complete messages render in a dialog
 * away from the field, so they name it; inline ones are already anchored to it. */
function messageLead(variable: Variable, config: ValidationConfig): string {
    const actionType = config.actionType || 'SHOWERROR'
    return ON_COMPLETE_ACTION_TYPES.includes(actionType)
        ? `${variable.name} must be`
        : 'Must be'
}

/** "1 month", "2 months" — units are stored plural (days/weeks/...). */
function formatInterval(amount: number | null | undefined, unit?: string) {
    const plural = unit || 'days'
    return `${amount} ${amount === 1 ? plural.replace(/s$/, '') : plural}`
}

export function getValidationPreview(
    currentVariable: Variable,
    config: ValidationConfig,
    variables: Variable[] | null
): PreviewTexts {
    const stageCount = countStages(variables)
    const clause = stageClause(currentVariable, stageCount)
    const lead = messageLead(currentVariable, config)
    if (currentVariable.category === 'numeric') {
        const varName = currentVariable.name
        const varDisplayName = getVariableDisplayName(
            currentVariable,
            stageCount
        )
        if (config.numericOperator === 'between') {
            const min = config.numericValue
            const max = config.numericValueMax
            if (
                min === null ||
                min === undefined ||
                max === null ||
                max === undefined
            ) {
                return EMPTY_PREVIEW
            }
            return {
                preview: `${varName} should be between ${min} and ${max} (inclusive)`,
                suggestedRuleName: `${varDisplayName} must be between ${min} and ${max} (inclusive)`,
                suggestedMessage: `${lead} between ${min} and ${max} (inclusive)`,
                suggestedDescription: `Validates that ${varName}${clause} is between ${min} and ${max} (inclusive)`,
            }
        }
        const opLabel = NUMERIC_OPERATOR_LABELS[config.numericOperator ?? '']
        if (!config.numericOperator || !opLabel) {
            return EMPTY_PREVIEW
        }
        let comparison: string | null = null
        if (
            config.numericComparisonType === 'field' &&
            config.numericComparisonField
        ) {
            comparison =
                findVariableByKey(variables, config.numericComparisonField)
                    ?.name ?? null
        } else if (
            config.numericComparisonType !== 'field' &&
            config.numericValue !== null &&
            config.numericValue !== undefined
        ) {
            comparison = String(config.numericValue)
        }
        if (comparison === null) {
            return EMPTY_PREVIEW
        }
        return {
            preview: `${varName} should be ${opLabel} ${comparison}`,
            suggestedRuleName: `${varDisplayName} must be ${opLabel} ${comparison}`,
            suggestedMessage: `${lead} ${opLabel} ${comparison}`,
            suggestedDescription: `Validates that ${varName}${clause} is ${opLabel} ${comparison}`,
        }
    }

    const operator = config.operator
    const variableName = currentVariable.name
    const variableDisplayName = getVariableDisplayName(
        currentVariable,
        stageCount
    )
    if (operator === 'between') {
        const lower = getDateComparisonLabel(config, variables)
        const upper = getUpperDateComparisonLabel(config, variables)
        if (!lower || !upper) {
            return EMPTY_PREVIEW
        }
        return {
            preview: `${variableName} should be between ${lower} and ${upper} (inclusive)`,
            suggestedRuleName: `${variableDisplayName} must be between ${lower} and ${upper} (inclusive)`,
            suggestedMessage: `${lead} between ${lower} and ${upper} (inclusive)`,
            suggestedDescription: `Validates that ${variableName}${clause} is between ${lower} and ${upper} (inclusive)`,
        }
    }
    const comparisonName = getDateComparisonLabel(config, variables)
    if (!operator || !comparisonName) {
        return EMPTY_PREVIEW
    }
    switch (operator) {
        case 'before':
        case 'after':
        case 'on_or_after':
        case 'on_or_before': {
            const phrase =
                operator === 'before'
                    ? 'before'
                    : operator === 'after'
                      ? 'after'
                      : operator === 'on_or_after'
                        ? 'on or after'
                        : 'on or before'
            const descPhrase =
                operator === 'on_or_after'
                    ? `is on the same date or after ${comparisonName}`
                    : operator === 'on_or_before'
                      ? `is on the same date or before ${comparisonName}`
                      : `is ${phrase} ${comparisonName}`
            return {
                preview: `${variableName} should be ${phrase} ${comparisonName}`,
                suggestedRuleName: `${variableDisplayName} must be ${phrase} ${comparisonName}`,
                suggestedMessage: `${lead} ${phrase} ${comparisonName}`,
                suggestedDescription: `Validates that ${variableName}${clause} ${descPhrase}`,
            }
        }
        case 'within_before':
        case 'within_after': {
            if (!config.intervalAmount || !config.intervalUnit) {
                return EMPTY_PREVIEW
            }
            const dir = operator === 'within_before' ? 'before' : 'after'
            const interval = formatInterval(
                config.intervalAmount,
                config.intervalUnit
            )
            return {
                preview: `${variableName} should be within ${interval} ${dir} ${comparisonName}`,
                suggestedRuleName: `${variableDisplayName} must be within ${interval} ${dir} ${comparisonName}`,
                suggestedMessage: `${lead} within ${interval} ${dir} ${comparisonName}`,
                suggestedDescription:
                    operator === 'within_before'
                        ? `Validates that ${variableName}${clause} is on ${comparisonName} or up to ${interval} before it (inclusive)`
                        : `Validates that ${variableName}${clause} is on ${comparisonName} or up to ${interval} after it (inclusive)`,
            }
        }
        default:
            return EMPTY_PREVIEW
    }
}

/**
 * Returns the human-readable labels of fields that still need a value before a
 * rule can be saved. Empty array = the config is complete. `isConfigComplete`
 * is defined in terms of this so the two never drift apart; the form renders
 * the list so a disabled "Save" button always has a visible reason.
 */
export function getMissingFieldLabels(
    currentVariable: Variable,
    config: ValidationConfig
): string[] {
    const missing: string[] = []
    const isMissing = (value: number | null | undefined) =>
        value === null || value === undefined
    if (currentVariable.category === 'numeric') {
        if (!config.numericOperator) {
            missing.push('Relationship')
        }
        if (config.numericOperator === 'between') {
            if (isMissing(config.numericValue)) {
                missing.push('Minimum value')
            }
            if (isMissing(config.numericValueMax)) {
                missing.push('Maximum value')
            }
        } else {
            if (
                config.numericComparisonType !== 'field' &&
                isMissing(config.numericValue)
            ) {
                missing.push('Comparison value')
            }
            if (
                config.numericComparisonType === 'field' &&
                !config.numericComparisonField
            ) {
                missing.push('Comparison field')
            }
        }
    } else {
        const comparisonMode = config.comparisonDateMode || 'variable'
        if (!config.operator) {
            missing.push('Relationship')
        }
        if (comparisonMode === 'variable' && !config.comparisonDate) {
            missing.push('Comparison date field')
        }
        if (comparisonMode === 'fixed' && !config.fixedComparisonDate) {
            missing.push('Comparison date')
        }
        if (comparisonMode === 'relative' && !config.relativeComparisonAmount) {
            missing.push('Offset amount')
        }
        if (
            (config.operator === 'within_before' ||
                config.operator === 'within_after') &&
            !config.intervalAmount
        ) {
            missing.push('Interval amount')
        }
        if (config.operator === 'between') {
            const upperMode = config.upperComparisonDateMode || 'variable'
            if (upperMode === 'variable' && !config.upperComparisonDate) {
                missing.push('Upper comparison date field')
            }
            if (upperMode === 'fixed' && !config.upperFixedComparisonDate) {
                missing.push('Upper comparison date')
            }
            if (
                upperMode === 'relative' &&
                !config.upperRelativeComparisonAmount
            ) {
                missing.push('Upper offset amount')
            }
        }
    }
    if (!config.ruleName) {
        missing.push('Rule name')
    }
    if (!config.ruleMessage) {
        missing.push('Validation message')
    }
    return missing
}

export type ConfigError =
    | 'MIN_GREATER_THAN_MAX'
    | 'EMPTY_DATE_RANGE'
    | 'INTERVAL_TOO_SMALL'
    | 'OFFSET_TOO_SMALL'

const isWholeAtLeastOne = (value: number | null | undefined) =>
    value === null ||
    value === undefined ||
    (Number.isInteger(value) && value >= 1)

/** Local calendar date as YYYY-MM-DD (V{current_date} is the device's date). */
function localToday(): string {
    const d = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function addDaysIso(iso: string, days: number): string {
    const [y, m, d] = iso.split('-').map(Number)
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/** A date bound as of today: an absolute date for fixed / current / relative
 * bounds (null for a field, whose value is unknown until data entry), plus
 * whether it moves with the current date. */
function boundAsOfToday(
    mode: ComparisonDateMode | undefined,
    fixed: string | undefined,
    amount: number | null | undefined,
    direction: RelativeDirection | undefined
): { date: string; moving: boolean } | null {
    if (mode === 'fixed') {
        return fixed ? { date: fixed, moving: false } : null
    }
    if (mode === 'current') {
        return { date: localToday(), moving: true }
    }
    if (mode === 'relative' && amount) {
        const offset = Math.abs(amount) * (direction === 'future' ? 1 : -1)
        return { date: addDaysIso(localToday(), offset), moving: true }
    }
    return null
}

/**
 * Configurations that are complete but would make a rule reject every value
 * (or never evaluate): a numeric range with min > max, a date range that is
 * empty today, an interval or offset that is not a whole number of at least
 * one. Saving is blocked while any are present. Accepts a variable or just a
 * category (bulk templates).
 */
export function getConfigErrors(
    currentVariable: Pick<Variable, 'category'>,
    config: ValidationConfig
): ConfigError[] {
    const errors: ConfigError[] = []
    if (currentVariable.category === 'numeric') {
        if (
            config.numericOperator === 'between' &&
            config.numericValue !== null &&
            config.numericValue !== undefined &&
            config.numericValueMax !== null &&
            config.numericValueMax !== undefined &&
            config.numericValue > config.numericValueMax
        ) {
            errors.push('MIN_GREATER_THAN_MAX')
        }
        return errors
    }
    if (
        (config.operator === 'within_before' ||
            config.operator === 'within_after') &&
        !isWholeAtLeastOne(config.intervalAmount)
    ) {
        errors.push('INTERVAL_TOO_SMALL')
    }
    const offsets = [
        config.comparisonDateMode === 'relative'
            ? config.relativeComparisonAmount
            : null,
        config.operator === 'between' &&
        config.upperComparisonDateMode === 'relative'
            ? config.upperRelativeComparisonAmount
            : null,
    ]
    if (offsets.some((amount) => amount === 0 || !isWholeAtLeastOne(amount))) {
        errors.push('OFFSET_TOO_SMALL')
    }
    if (config.operator === 'between') {
        const lower = boundAsOfToday(
            config.comparisonDateMode,
            config.fixedComparisonDate,
            config.relativeComparisonAmount,
            config.relativeComparisonDirection
        )
        const upper = boundAsOfToday(
            config.upperComparisonDateMode,
            config.upperFixedComparisonDate,
            config.upperRelativeComparisonAmount,
            config.upperRelativeComparisonDirection
        )
        // Moving bounds keep their distance, so comparing them today decides
        // it for good; a fixed vs moving pair is judged as of today (the rule
        // would reject everything now).
        if (lower && upper && lower.date > upper.date) {
            errors.push('EMPTY_DATE_RANGE')
        }
    }
    return errors
}

export function isConfigComplete(
    currentVariable: Variable,
    config: ValidationConfig
): boolean {
    return getMissingFieldLabels(currentVariable, config).length === 0
}

/**
 * True when a date rule rejects future dates (errors on dates after today):
 * "before"/"on or before" the current date, or "between … and the current
 * date". Used to warn about a contradiction on a field that is explicitly
 * configured to allow future dates.
 */
export function ruleRejectsFutureDates(config: ValidationConfig): boolean {
    const { operator } = config
    if (
        (operator === 'before' || operator === 'on_or_before') &&
        config.comparisonDateMode === 'current'
    ) {
        return true
    }
    if (
        operator === 'between' &&
        config.upperComparisonDateMode === 'current'
    ) {
        return true
    }
    return false
}

/**
 * Build the form configuration for editing an existing rule from its parsed
 * condition. Strips the configured rule-name prefix so saving doesn't apply
 * it twice.
 */
export function buildEditConfig(
    parsed: ParsedRuleCondition,
    rule: ProgramRule,
    action: ProgramRuleAction,
    currentVariable: Variable,
    variables: Variable[] | null,
    programRulePrefix?: string
): ValidationConfig {
    let strippedName = rule.name
    if (
        programRulePrefix &&
        strippedName.startsWith(`${programRulePrefix} - `)
    ) {
        strippedName = strippedName.substring(programRulePrefix.length + 3)
    }
    const strippedDesc = removeAllSignatures(rule.description || '')
    const storedMessage = action.content || ''

    let structural: ValidationConfig
    if (currentVariable.category === 'numeric') {
        structural = {
            numericOperator: parsed.config.operator,
            numericComparisonType:
                parsed.config.comparisonType === 'field' ? 'field' : 'value',
            numericValue: parsed.config.value ?? null,
            numericValueMax: parsed.config.valueMax ?? null,
            numericComparisonField: parsed.variable2
                ? getVariableKey(parsed.variable2)
                : '',
        }
    } else {
        const lower = mapDateVariableToFields(parsed.variable2)
        if (parsed.config.operator === 'between') {
            const upper = mapDateVariableToFields(parsed.variable3 ?? null)
            structural = {
                operator: 'between',
                comparisonDateMode: lower.mode,
                comparisonDate: lower.comparisonDate,
                fixedComparisonDate: lower.fixedComparisonDate,
                relativeComparisonAmount: lower.relativeAmount,
                relativeComparisonUnit: lower.relativeUnit,
                relativeComparisonDirection: lower.relativeDirection,
                upperComparisonDateMode: upper.mode,
                upperComparisonDate: upper.comparisonDate,
                upperFixedComparisonDate: upper.fixedComparisonDate,
                upperRelativeComparisonAmount: upper.relativeAmount,
                upperRelativeComparisonUnit: upper.relativeUnit,
                upperRelativeComparisonDirection: upper.relativeDirection,
            }
        } else {
            structural = {
                operator: parsed.config.operator,
                comparisonDateMode: lower.mode,
                comparisonDate: lower.comparisonDate,
                fixedComparisonDate: lower.fixedComparisonDate,
                relativeComparisonAmount: lower.relativeAmount,
                relativeComparisonUnit: lower.relativeUnit,
                relativeComparisonDirection: lower.relativeDirection,
                intervalAmount: parsed.config.intervalAmount ?? null,
                intervalUnit: parsed.config.intervalUnit || 'days',
            }
        }
    }

    // The default message depends on the action type, so the "is this still the
    // default?" comparison has to use the rule's own action type — otherwise
    // every on-complete rule looks customized and stops re-syncing.
    const actionType = action.programRuleActionType || 'SHOWERROR'
    const suggested = getSuggestedRuleTexts(
        currentVariable,
        { ...structural, actionType },
        variables
    )
    // A generated name stays "default" under any prefix (the configured one
    // may have changed since the rule was created), so it is regenerated
    // with the current prefix instead of being kept as "OLD - name".
    const nameIsDefault =
        strippedName === suggested.name ||
        rule.name.endsWith(` - ${suggested.name}`)
    return {
        ...structural,
        ruleName: nameIsDefault ? undefined : strippedName,
        ruleDescription:
            strippedDesc === suggested.description ? undefined : strippedDesc,
        ruleMessage:
            storedMessage === suggested.message ? undefined : storedMessage,
        actionType,
    }
}

/** Map a parsed comparison Variable back to the form's date-bound fields. */
function mapDateVariableToFields(variable: Variable | null): {
    mode: ComparisonDateMode
    comparisonDate: string
    fixedComparisonDate: string
    relativeAmount: number | null
    relativeUnit: string
    relativeDirection: RelativeDirection
} {
    const fields = {
        mode: 'variable' as ComparisonDateMode,
        comparisonDate: '',
        fixedComparisonDate: '',
        relativeAmount: null as number | null,
        relativeUnit: 'days',
        relativeDirection: 'past' as RelativeDirection,
    }
    if (variable?.type === 'fixed_date') {
        fields.mode = 'fixed'
        fields.fixedComparisonDate = variable.id
    } else if (variable?.type === 'current_date') {
        fields.mode = 'current'
    } else if (variable?.type === 'relative_current_date') {
        fields.mode = 'relative'
        fields.relativeAmount = variable.relativeAmount ?? null
        fields.relativeUnit = variable.relativeUnit || 'days'
        fields.relativeDirection = variable.relativeDirection || 'past'
    } else if (variable) {
        fields.comparisonDate = getVariableKey(variable)
    }
    return fields
}

export function createBatchTemplateKey(template: BatchTemplate): string {
    return [
        template.category,
        template.scope || 'programme',
        template.stageId || '',
        template.operator || '',
        template.numericOperator || '',
        template.numericValue ?? '',
        template.numericValueMax ?? '',
        template.comparisonDateMode || '',
        template.fixedComparisonDate || '',
        template.relativeComparisonAmount || '',
        template.relativeComparisonUnit || '',
        template.relativeComparisonDirection || '',
        template.upperComparisonDateMode || '',
        template.upperFixedComparisonDate || '',
        template.upperRelativeComparisonAmount || '',
        template.upperRelativeComparisonUnit || '',
        template.upperRelativeComparisonDirection || '',
        template.actionType || 'SHOWERROR',
    ].join('|')
}

function batchBoundLabel(
    mode: ComparisonDateMode | undefined,
    fixed: string | undefined,
    amount: number | null | undefined,
    unit: string | undefined,
    direction: RelativeDirection | undefined
): string {
    if (mode === 'fixed') {
        return fixed ?? ''
    }
    if (mode === 'current') {
        return 'current date'
    }
    if (mode === 'relative') {
        return `${formatInterval(amount, unit)} ${
            direction === 'past' ? 'before' : 'after'
        } current date`
    }
    return 'another date'
}

export function getBatchTemplateSummary(template: BatchTemplate): string {
    if (template.category === 'numeric') {
        if (template.numericOperator === 'between') {
            return `Any unvalidated numeric variable should be between ${template.numericValue} and ${template.numericValueMax} (inclusive)`
        }
        return `Any unvalidated numeric variable should be ${
            NUMERIC_OPERATOR_LABELS[template.numericOperator ?? ''] ||
            template.numericOperator
        } ${template.numericValue}`
    }

    const comparisonLabel = batchBoundLabel(
        template.comparisonDateMode,
        template.fixedComparisonDate,
        template.relativeComparisonAmount,
        template.relativeComparisonUnit,
        template.relativeComparisonDirection
    )
    if (template.operator === 'between') {
        const upperLabel = batchBoundLabel(
            template.upperComparisonDateMode,
            template.upperFixedComparisonDate,
            template.upperRelativeComparisonAmount,
            template.upperRelativeComparisonUnit,
            template.upperRelativeComparisonDirection
        )
        return `Any unvalidated date should be between ${comparisonLabel} and ${upperLabel} (inclusive)`
    }
    if (
        template.operator === 'within_before' ||
        template.operator === 'within_after'
    ) {
        return `Any unvalidated date should be within ${formatInterval(
            template.intervalAmount,
            template.intervalUnit
        )} ${template.operator === 'within_before' ? 'before' : 'after'} ${comparisonLabel}`
    }
    return `Any unvalidated date should be ${
        DATE_OPERATOR_LABELS[template.operator ?? ''] || template.operator
    } ${comparisonLabel}`
}

export function getSuggestedRuleTexts(
    currentVariable: Variable,
    config: ValidationConfig,
    variables: Variable[] | null
): { name: string; description: string; message: string } {
    const p = getValidationPreview(currentVariable, config, variables)
    return {
        name: p.suggestedRuleName,
        description: p.suggestedDescription,
        message: p.suggestedMessage,
    }
}

/**
 * Enrollment, incident, event and due dates are "basic info" fields: a rule
 * validating one has no data element or attribute to attach its message to.
 * The DHIS2 Android Capture app (3.4.2, ANDROAPP-7843) shows no message for
 * such rules and does not block saving; the server then rejects the record
 * when the device syncs. Capture web shows them.
 */
export function isBasicInfoDate(variable: Pick<Variable, 'type'>): boolean {
    return ['enrollment', 'incident', 'event_date', 'due_date'].includes(
        variable.type
    )
}
