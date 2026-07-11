// Program rule signature and edit detection utilities
import { prGetExisting } from './detector'
import { parseBetweenExpression, stripNullGuard } from './expression'
import type {
    ParsedRuleCondition,
    ProgramMetadata,
    ProgramRule,
    ValidationConfig,
    Variable,
} from './types'

export function getAppSignature(): string {
    return 'DVT'
}

export function addAppSignature(
    ruleName: string,
    description?: string
): { name: string; description: string } {
    const signature = getAppSignature()
    const signaturePrefix = `[${signature}]`

    // Only add signature to description, not name
    const descWithSignature =
        description && !description.startsWith(signaturePrefix)
            ? `${signaturePrefix} ${description}`
            : description || `${signaturePrefix} Date validation rule`

    return { name: ruleName, description: descWithSignature }
}

export function isAppGenerated(rule: ProgramRule): boolean {
    const signature = getAppSignature()
    const signaturePrefix = `[${signature}]`

    // Check if the description starts with our signature
    return Boolean(
        rule.description && rule.description.startsWith(signaturePrefix)
    )
}

export const BATCH_TAG = 'DVT-BATCH'

export function isBatchGenerated(rule: ProgramRule): boolean {
    const batchPrefix = `[${BATCH_TAG}]`
    return (
        isAppGenerated(rule) && Boolean(rule.description?.includes(batchPrefix))
    )
}

export function addBatchSignature(
    ruleName: string,
    description?: string
): { name: string; description: string } {
    const { name, description: signedDesc } = addAppSignature(
        ruleName,
        description
    )
    const batchPrefix = `[${BATCH_TAG}]`
    // Return early if already tagged (idempotent)
    if (signedDesc.includes(batchPrefix)) {
        return { name, description: signedDesc }
    }
    const signature = getAppSignature()
    const descWithBatch = signedDesc.replace(
        new RegExp(`^\\[${signature}\\]\\s*`),
        `[${signature}] ${batchPrefix} `
    )
    return { name, description: descWithBatch }
}

export function removeAppSignature(text?: string): string {
    if (!text) {
        return text ?? ''
    }
    const signature = getAppSignature()
    const signaturePrefix = `[${signature}]`
    if (text.startsWith(signaturePrefix)) {
        return text.substring(signaturePrefix.length).trim()
    }
    return text
}

export function getConfigurationSignature(
    variable1: Variable,
    variable2: Variable,
    config: ValidationConfig
): string {
    // Create a unique signature based on the configuration parameters
    const parts = [
        variable1.type,
        variable1.id,
        variable1.stageId || 'null',
        config.operator ?? '',
        variable2.type,
        variable2.id,
        variable2.stageId || 'null',
    ]

    if (config.intervalAmount && config.intervalUnit) {
        parts.push(config.intervalAmount.toString(), config.intervalUnit)
    }

    return parts.join('|')
}

export function findDuplicateRule(
    programMetadata: ProgramMetadata | null,
    variable: Variable | null,
    config: ValidationConfig | null
): ProgramRule | null {
    if (!programMetadata || !variable || !config) {
        return null
    }

    let compareVariable: Partial<Variable>
    const comparisonMode = config.comparisonDateMode || 'variable'
    if (comparisonMode === 'fixed') {
        compareVariable = { type: 'fixed_date', id: config.fixedComparisonDate }
    } else if (comparisonMode === 'current') {
        compareVariable = { type: 'current_date', id: 'current_date' }
    } else if (comparisonMode === 'relative') {
        compareVariable = {
            type: 'relative_current_date',
            id: `current_date_${config.relativeComparisonDirection || 'past'}_${Math.abs(
                config.relativeComparisonAmount ?? 0
            )}_${config.relativeComparisonUnit || 'days'}`,
        }
    } else {
        const comparisonDate = config.comparisonDate ?? ''
        const [compareType, compareId, compareStageId] =
            comparisonDate.split(':')
        compareVariable = {
            type: compareType as Variable['type'],
            id: compareId,
            stageId: compareStageId,
        }
    }

    // Look for existing rules that target the same variables regardless of who created them
    const existingValidations = prGetExisting(programMetadata, variable)

    for (const validation of existingValidations) {
        const { rule } = validation

        // Try to extract configuration from the rule condition
        const ruleConfig = parseRuleCondition(
            rule.condition,
            programMetadata,
            variable
        )
        if (!ruleConfig || !ruleConfig.variable2) {
            continue
        }

        // Parsed references take stage from the PRV, which this app doesn't
        // stage-scope — treat a missing stage on either side as a match.
        const sameStage = (a?: string, b?: string) => !a || !b || a === b
        const sameVar = (a: Partial<Variable>, b: Partial<Variable>) =>
            a.type === b.type &&
            a.id === b.id &&
            sameStage(a.stageId, b.stageId)

        // Check if this rule uses the same two variables AND the same operator
        const sameVariables =
            (sameVar(ruleConfig.variable1, variable) &&
                sameVar(ruleConfig.variable2, compareVariable)) ||
            // Also check reversed order
            (sameVar(ruleConfig.variable1, compareVariable) &&
                sameVar(ruleConfig.variable2, variable))
        const sameOperator = ruleConfig.config?.operator === config.operator
        if (sameVariables && sameOperator) {
            return rule
        }
    }

    return null
}

const NUMERIC_OP_REVERSE_MAP: Record<string, string> = {
    '>': 'greater_than',
    '>=': 'greater_than_or_equal',
    '<': 'less_than',
    '<=': 'less_than_or_equal',
    '==': 'equal_to',
    '!=': 'not_equal_to',
}

export function parseRuleCondition(
    condition: string,
    programMetadata: ProgramMetadata,
    targetVariable: Variable | null = null
): ParsedRuleCondition | null {
    // Strip leading d2:hasValue() guard before parsing
    condition = stripNullGuard(condition)

    const betweenExpression = parseBetweenExpression(condition)

    // Parse d2:daysBetween date comparison conditions (robust)
    if (betweenExpression && betweenExpression.unit === 'days') {
        const variable1 = parseVariableReference(
            betweenExpression.ref1,
            programMetadata
        )
        const variable2 = parseVariableReference(
            betweenExpression.ref2,
            programMetadata
        )
        if (!variable1 || !variable2) {
            return null
        }
        let operator: string
        const numValue = betweenExpression.value
        // Support all valid patterns
        if (betweenExpression.op === '<' && numValue === 0) {
            operator = 'before'
        } else if (betweenExpression.op === '>' && numValue === 0) {
            operator = 'after'
        } else if (betweenExpression.op === '>=' && numValue === 0) {
            operator = 'on_or_after'
        } else if (betweenExpression.op === '<=' && numValue === 0) {
            operator = 'on_or_before'
        } else if (betweenExpression.op === '>' && numValue > 0) {
            // This could be an interval condition - check if we have targetVariable context
            if (targetVariable) {
                const ref2IsTarget =
                    variable2.id === targetVariable.id &&
                    variable2.type === targetVariable.type
                operator = ref2IsTarget ? 'within_before' : 'within_after'
            } else {
                operator = 'within_after' // default
            }
        } else if (betweenExpression.op === '<' && numValue < 0) {
            // This could be an interval condition - check if we have targetVariable context
            if (targetVariable) {
                const ref2IsTarget =
                    variable2.id === targetVariable.id &&
                    variable2.type === targetVariable.type
                operator = ref2IsTarget ? 'within_before' : 'within_after'
            } else {
                operator = 'within_after' // default
            }
        } else {
            // Accept any numeric comparison for editing, fallback to generic
            operator = 'custom'
        }
        // Add interval-specific fields for interval operators
        const config: ParsedRuleCondition['config'] = {
            operator,
            value: numValue,
        }
        if (operator === 'within_after' || operator === 'within_before') {
            config.intervalAmount = numValue
            config.intervalUnit = 'days' // Default to days for daysBetween function
        }

        return {
            variable1,
            variable2,
            config,
        }
    }

    // Parse interval-based conditions (d2:daysBetween/d2:weeksBetween/etc with amounts > 0)
    if (betweenExpression) {
        const parsedRef1 = parseVariableReference(
            betweenExpression.ref1,
            programMetadata
        )
        const parsedRef2 = parseVariableReference(
            betweenExpression.ref2,
            programMetadata
        )
        if (!parsedRef1 || !parsedRef2) {
            return null
        }

        // Determine direction using targetVariable context:
        // within_after:  d2:*Between(targetRef, compareRef) — target is ref1 (first arg)
        // within_before: d2:*Between(compareRef, targetRef) — target is ref2 (second arg)
        let operator = 'within_after' // default (no context)
        let variable1 = parsedRef1 // target (validated date)
        let variable2 = parsedRef2 // comparison date

        if (targetVariable) {
            const ref2IsTarget =
                parsedRef2.id === targetVariable.id &&
                parsedRef2.type === targetVariable.type
            if (ref2IsTarget) {
                operator = 'within_before'
                variable1 = parsedRef2 // swap: return target first
                variable2 = parsedRef1
            }
        }

        return {
            variable1,
            variable2,
            config: {
                operator,
                intervalAmount: betweenExpression.value,
                intervalUnit: betweenExpression.unit,
            },
        }
    }

    // Parse numeric field-to-field: #{VAR1} OP #{VAR2}
    const numericFieldMatch = condition.match(
        /#{([^}]+)}\s*(>=|<=|>|<|==|!=)\s*#{([^}]+)}/
    )
    if (numericFieldMatch) {
        const [, prvName1, op, prvName2] = numericFieldMatch
        const variable1 = parseVariableReference(prvName1, programMetadata)
        const variable2 = parseVariableReference(prvName2, programMetadata)
        if (!variable1 || !variable2) {
            return null
        }
        const operator = NUMERIC_OP_REVERSE_MAP[op] || op
        return {
            variable1,
            variable2,
            config: { operator, comparisonType: 'field' },
        }
    }

    // Parse numeric literal: #{VAR} OP number
    const numericLiteralMatch = condition.match(
        /#{([^}]+)}\s*(>=|<=|>|<|==|!=)\s*(-?\d+(?:\.\d+)?)/
    )
    if (numericLiteralMatch) {
        const [, prvName, op, rawValue] = numericLiteralMatch
        const variable1 = parseVariableReference(prvName, programMetadata)
        if (!variable1) {
            return null
        }
        const operator = NUMERIC_OP_REVERSE_MAP[op] || op
        return {
            variable1,
            variable2: null,
            config: {
                operator,
                comparisonType: 'value',
                value: parseFloat(rawValue),
            },
        }
    }

    return null
}

function parseVariableReference(
    varRef: string,
    programMetadata: ProgramMetadata
): Variable | null {
    if (!varRef) {
        return null
    }
    if (/^'\d{4}-\d{2}-\d{2}'$/.test(varRef)) {
        const dateValue = varRef.slice(1, -1)
        return { type: 'fixed_date', id: dateValue, name: dateValue }
    }

    const relativeCurrentMatch = varRef.match(
        /^d2:add(Days|Months|Years)\(V\{current_date\},\s*(-?\d+)\)$/
    )
    if (relativeCurrentMatch) {
        const unit = relativeCurrentMatch[1].toLowerCase()
        const rawAmount = parseInt(relativeCurrentMatch[2], 10)
        const relativeAmount = Math.abs(rawAmount)
        const relativeDirection = rawAmount < 0 ? 'past' : 'future'
        const label = `${relativeAmount} ${unit} ${
            relativeDirection === 'past' ? 'before' : 'after'
        } current date`
        return {
            type: 'relative_current_date',
            id: `current_date_${relativeDirection}_${relativeAmount}_${unit}`,
            name: label,
            relativeAmount,
            relativeUnit: unit,
            relativeDirection,
        }
    }

    const cleanVarRef = varRef.trim().replace(/^V\{|\}$/g, '')
    // Handle system variables
    if (cleanVarRef === 'enrollment_date') {
        return {
            type: 'enrollment',
            id: 'enrollment_date',
            name: 'Enrollment date',
        }
    }
    if (cleanVarRef === 'incident_date') {
        return { type: 'incident', id: 'incident_date', name: 'Incident date' }
    }
    if (cleanVarRef === 'event_date') {
        return { type: 'event_date', id: 'event_date', name: 'Event date' }
    }
    if (cleanVarRef === 'current_date') {
        return {
            type: 'current_date',
            id: 'current_date',
            name: 'Current date',
        }
    }

    // Handle program rule variables (data elements and attributes)
    const prvName = cleanVarRef.replace(/[#{}]/g, '')
    // Only match by PRV name
    const prv = programMetadata.programRuleVariables?.find(
        (v) => v.name === prvName
    )
    if (!prv) {
        return null
    }
    if (prv.dataElement) {
        return {
            type: 'dataElement',
            id: prv.dataElement.id,
            name: prvName,
            stageId: prv.programStage?.id,
        }
    }
    if (prv.trackedEntityAttribute) {
        return {
            type: 'trackedEntityAttribute',
            id: prv.trackedEntityAttribute.id,
            name: prvName,
        }
    }
    return null
}
