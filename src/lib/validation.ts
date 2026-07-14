// Pure form/validation helpers shared by the details form and batch workspace
import { prGetExisting } from './detector'
import { removeAppSignature } from './signature'
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
        name: `${normalizedAmount} ${normalizedUnit} ${
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
            ? `${amount} ${unit} ${direction === 'past' ? 'before' : 'after'} current date`
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

export function getValidationPreview(
    currentVariable: Variable,
    config: ValidationConfig,
    variables: Variable[] | null
): PreviewTexts {
    if (currentVariable.category === 'numeric') {
        const varName = currentVariable.name
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
                preview: `${varName} should be between ${min} and ${max}`,
                suggestedRuleName: `${varName} must be between ${min} and ${max}`,
                suggestedMessage: `${varName} must be between ${min} and ${max}`,
                suggestedDescription: `Validates that ${varName} is between ${min} and ${max}`,
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
            suggestedRuleName: `${varName} must be ${opLabel} ${comparison}`,
            suggestedMessage: `${varName} must be ${opLabel} ${comparison}`,
            suggestedDescription: `Validates that ${varName} is ${opLabel} ${comparison}`,
        }
    }

    const operator = config.operator
    const variableName = currentVariable.name
    if (operator === 'between') {
        const lower = getDateComparisonLabel(config, variables)
        const upper = getUpperDateComparisonLabel(config, variables)
        if (!lower || !upper) {
            return EMPTY_PREVIEW
        }
        return {
            preview: `${variableName} should be between ${lower} and ${upper}`,
            suggestedRuleName: `${variableName} must be between ${lower} and ${upper}`,
            suggestedMessage: `${variableName} must be between ${lower} and ${upper}`,
            suggestedDescription: `Validates that ${variableName} is between ${lower} and ${upper}`,
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
                operator === 'before'
                    ? `is entered before ${comparisonName}`
                    : operator === 'after'
                      ? `is entered after ${comparisonName}`
                      : operator === 'on_or_after'
                        ? `is on the same date or after ${comparisonName}`
                        : `is on the same date or before ${comparisonName}`
            return {
                preview: `${variableName} should be ${phrase} ${comparisonName}`,
                suggestedRuleName: `${variableName} must be ${phrase} ${comparisonName}`,
                suggestedMessage: `${variableName} must be ${phrase} ${comparisonName}`,
                suggestedDescription: `Validates that ${variableName} ${descPhrase}`,
            }
        }
        case 'within_before':
        case 'within_after': {
            if (!config.intervalAmount || !config.intervalUnit) {
                return EMPTY_PREVIEW
            }
            const dir = operator === 'within_before' ? 'before' : 'after'
            const interval = `${config.intervalAmount} ${config.intervalUnit}`
            return {
                preview: `${variableName} should be within ${interval} ${dir} ${comparisonName}`,
                suggestedRuleName: `${variableName} within ${interval} ${dir} ${comparisonName}`,
                suggestedMessage: `${variableName} must be within ${interval} ${dir} ${comparisonName}`,
                suggestedDescription: `Validates that ${variableName} is no more than ${interval} ${dir} ${comparisonName}`,
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

export function generateDefaultDescription(
    variable1: Variable,
    variable2: Variable,
    operator: string | undefined,
    intervalAmount?: number | null,
    intervalUnit?: string
): string {
    const var1Name = variable1.name
    const var2Name = variable2.name

    switch (operator) {
        case 'before':
            return `Validates that ${var1Name} is entered before ${var2Name}`
        case 'after':
            return `Validates that ${var1Name} is entered after ${var2Name}`
        case 'on_or_after':
            return `Validates that ${var1Name} is on the same date or after ${var2Name}`
        case 'on_or_before':
            return `Validates that ${var1Name} is on the same date or before ${var2Name}`
        case 'within_before':
            return `Validates that ${var1Name} is no more than ${intervalAmount} ${intervalUnit} before ${var2Name}`
        case 'within_after':
            return `Validates that ${var1Name} is no more than ${intervalAmount} ${intervalUnit} after ${var2Name}`
        default:
            return `Date validation rule for ${var1Name}`
    }
}

export function generateDefaultNumericDescription(
    variable: Variable,
    operator: string | undefined,
    comparisonType: string | undefined,
    value: number | null | undefined,
    compareField: Variable | null
): string {
    const opLabel = NUMERIC_OPERATOR_LABELS[operator ?? ''] || operator
    if (comparisonType === 'field') {
        return `Validates that ${variable.name} is ${opLabel} ${compareField?.name || 'another field'}`
    }
    return `Validates that ${variable.name} is ${opLabel} ${value}`
}

export function generateDefaultNumericMessage(
    variable: Variable,
    operator: string | undefined,
    comparisonType: string | undefined,
    value: number | null | undefined,
    compareField: Variable | null
): string {
    const opLabel = NUMERIC_OPERATOR_LABELS[operator ?? ''] || operator
    if (comparisonType === 'field') {
        return `${variable.name} must be ${opLabel} ${compareField?.name || 'another field'}`
    }
    return `${variable.name} must be ${opLabel} ${value}`
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
    programRulePrefix?: string
): ValidationConfig {
    let ruleName = rule.name
    if (programRulePrefix && ruleName.startsWith(`${programRulePrefix} - `)) {
        ruleName = ruleName.substring(programRulePrefix.length + 3)
    }
    const base: ValidationConfig = {
        ruleName,
        ruleDescription: removeAppSignature(rule.description || ''),
        ruleMessage: action.content || '',
        actionType: action.programRuleActionType || 'SHOWERROR',
    }

    if (currentVariable.category === 'numeric') {
        return {
            ...base,
            numericOperator: parsed.config.operator,
            numericComparisonType:
                parsed.config.comparisonType === 'field' ? 'field' : 'value',
            numericValue: parsed.config.value ?? null,
            numericValueMax: parsed.config.valueMax ?? null,
            numericComparisonField: parsed.variable2
                ? getVariableKey(parsed.variable2)
                : '',
        }
    }

    const lower = mapDateVariableToFields(parsed.variable2)
    if (parsed.config.operator === 'between') {
        const upper = mapDateVariableToFields(parsed.variable3 ?? null)
        return {
            ...base,
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
    }

    return {
        ...base,
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
        relativeUnit: 'years',
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
        fields.relativeUnit = variable.relativeUnit || 'years'
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
        return `${amount} ${unit} ${
            direction === 'past' ? 'before' : 'after'
        } current date`
    }
    return 'another date'
}

export function getBatchTemplateSummary(template: BatchTemplate): string {
    if (template.category === 'numeric') {
        if (template.numericOperator === 'between') {
            return `Any unvalidated numeric variable should be between ${template.numericValue} and ${template.numericValueMax}`
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
        return `Any unvalidated date should be between ${comparisonLabel} and ${upperLabel}`
    }
    if (
        template.operator === 'within_before' ||
        template.operator === 'within_after'
    ) {
        return `Any unvalidated date should be within ${template.intervalAmount} ${
            template.intervalUnit
        } ${template.operator === 'within_before' ? 'before' : 'after'} ${comparisonLabel}`
    }
    return `Any unvalidated date should be ${
        DATE_OPERATOR_LABELS[template.operator ?? ''] || template.operator
    } ${comparisonLabel}`
}
