// Pure form/validation helpers shared by the details form and batch workspace
import { prGetExisting } from './detector'
import { removeAppSignature } from './signature'
import type {
    BatchTemplate,
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
}

export const NUMERIC_OPERATOR_LABELS: Record<string, string> = {
    greater_than: 'greater than',
    greater_than_or_equal: 'greater than or equal to',
    less_than: 'less than',
    less_than_or_equal: 'less than or equal to',
    equal_to: 'equal to',
    not_equal_to: 'not equal to',
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

export function resolveDateComparisonTarget(
    config: ValidationConfig,
    variables: Variable[] | null
): Variable | null {
    const comparisonMode = config.comparisonDateMode || 'variable'
    if (comparisonMode === 'fixed') {
        if (!config.fixedComparisonDate) {
            return null
        }
        return {
            type: 'fixed_date',
            id: config.fixedComparisonDate,
            name: config.fixedComparisonDate,
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
            config.relativeComparisonAmount,
            config.relativeComparisonUnit,
            config.relativeComparisonDirection
        )
    }
    if (!config.comparisonDate) {
        return null
    }
    return findVariableByKey(variables, config.comparisonDate)
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

export function getDateComparisonLabel(
    config: ValidationConfig,
    variables: Variable[] | null
): string {
    const mode = config.comparisonDateMode || 'variable'
    if (mode === 'fixed') {
        return config.fixedComparisonDate || ''
    }
    if (mode === 'current') {
        return 'Current date'
    }
    if (mode === 'relative') {
        const amount = config.relativeComparisonAmount
        const unit = config.relativeComparisonUnit || 'days'
        const direction = config.relativeComparisonDirection || 'past'
        return amount
            ? `${amount} ${unit} ${direction === 'past' ? 'before' : 'after'} current date`
            : ''
    }
    if (!config.comparisonDate) {
        return ''
    }
    return findVariableByKey(variables, config.comparisonDate)?.name ?? ''
}

export function getValidationPreview(
    currentVariable: Variable,
    config: ValidationConfig,
    variables: Variable[] | null
): PreviewTexts {
    if (currentVariable.category === 'numeric') {
        const opLabel = NUMERIC_OPERATOR_LABELS[config.numericOperator ?? '']
        const varName = currentVariable.name
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
    const comparisonName = getDateComparisonLabel(config, variables)
    if (!operator || !comparisonName) {
        return EMPTY_PREVIEW
    }
    const variableName = currentVariable.name
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

export function isConfigComplete(
    currentVariable: Variable,
    config: ValidationConfig
): boolean {
    if (!config.ruleName || !config.ruleMessage) {
        return false
    }
    if (currentVariable.category === 'numeric') {
        if (!config.numericOperator) {
            return false
        }
        if (
            config.numericComparisonType !== 'field' &&
            (config.numericValue === null || config.numericValue === undefined)
        ) {
            return false
        }
        if (
            config.numericComparisonType === 'field' &&
            !config.numericComparisonField
        ) {
            return false
        }
        return true
    }
    const comparisonMode = config.comparisonDateMode || 'variable'
    if (!config.operator) {
        return false
    }
    let hasComparisonTarget = false
    if (comparisonMode === 'variable') {
        hasComparisonTarget = Boolean(config.comparisonDate)
    }
    if (comparisonMode === 'fixed') {
        hasComparisonTarget = Boolean(config.fixedComparisonDate)
    }
    if (comparisonMode === 'current') {
        hasComparisonTarget = true
    }
    if (comparisonMode === 'relative') {
        hasComparisonTarget = Boolean(config.relativeComparisonAmount)
    }
    if (!hasComparisonTarget) {
        return false
    }
    if (
        (config.operator === 'within_before' ||
            config.operator === 'within_after') &&
        !config.intervalAmount
    ) {
        return false
    }
    return true
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
            numericComparisonField: parsed.variable2
                ? getVariableKey(parsed.variable2)
                : '',
        }
    }

    const variable2 = parsed.variable2
    let comparisonDateMode: ValidationConfig['comparisonDateMode'] = 'variable'
    let comparisonDate = ''
    let fixedComparisonDate = ''
    let relativeComparisonAmount: number | null = null
    let relativeComparisonUnit = 'years'
    let relativeComparisonDirection: RelativeDirection = 'past'
    if (variable2?.type === 'fixed_date') {
        comparisonDateMode = 'fixed'
        fixedComparisonDate = variable2.id
    } else if (variable2?.type === 'current_date') {
        comparisonDateMode = 'current'
    } else if (variable2?.type === 'relative_current_date') {
        comparisonDateMode = 'relative'
        relativeComparisonAmount = variable2.relativeAmount ?? null
        relativeComparisonUnit = variable2.relativeUnit || 'years'
        relativeComparisonDirection = variable2.relativeDirection || 'past'
    } else if (variable2) {
        comparisonDate = getVariableKey(variable2)
    }

    return {
        ...base,
        operator: parsed.config.operator,
        comparisonDateMode,
        comparisonDate,
        fixedComparisonDate,
        relativeComparisonAmount,
        relativeComparisonUnit,
        relativeComparisonDirection,
        intervalAmount: parsed.config.intervalAmount ?? null,
        intervalUnit: parsed.config.intervalUnit || 'days',
    }
}

export function createBatchTemplateKey(template: BatchTemplate): string {
    return [
        template.category,
        template.scope || 'programme',
        template.stageId || '',
        template.operator || '',
        template.numericOperator || '',
        template.numericValue ?? '',
        template.comparisonDateMode || '',
        template.fixedComparisonDate || '',
        template.relativeComparisonAmount || '',
        template.relativeComparisonUnit || '',
        template.relativeComparisonDirection || '',
        template.actionType || 'SHOWERROR',
    ].join('|')
}

export function getBatchTemplateSummary(template: BatchTemplate): string {
    if (template.category === 'numeric') {
        return `Any unvalidated numeric variable should be ${
            NUMERIC_OPERATOR_LABELS[template.numericOperator ?? ''] ||
            template.numericOperator
        } ${template.numericValue}`
    }

    let comparisonLabel = 'another date'
    if (template.comparisonDateMode === 'fixed') {
        comparisonLabel = template.fixedComparisonDate ?? ''
    }
    if (template.comparisonDateMode === 'current') {
        comparisonLabel = 'current date'
    }
    if (template.comparisonDateMode === 'relative') {
        comparisonLabel = `${template.relativeComparisonAmount} ${
            template.relativeComparisonUnit
        } ${template.relativeComparisonDirection === 'past' ? 'before' : 'after'} current date`
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
