export type VariableCategory = 'date' | 'numeric'

export type VariableType =
    | 'enrollment'
    | 'incident'
    | 'event_date'
    | 'due_date'
    | 'current_date'
    | 'fixed_date'
    | 'relative_current_date'
    | 'dataElement'
    | 'trackedEntityAttribute'

export type RelativeDirection = 'past' | 'future'

export interface Variable {
    id: string
    name: string
    type: VariableType
    category?: VariableCategory
    valueType?: string
    stageId?: string
    stageName?: string
    prvName?: string
    relativeAmount?: number
    relativeUnit?: string
    relativeDirection?: RelativeDirection
}

export interface ProgramRule {
    id: string
    name: string
    description?: string
    condition: string
    program?: { id: string }
    programStage?: { id: string }
    priority?: number
}

export type RuleActionType =
    | 'SHOWERROR'
    | 'SHOWWARNING'
    | 'ERRORONCOMPLETE'
    | 'WARNINGONCOMPLETE'

export interface ProgramRuleAction {
    id: string
    programRule: { id: string }
    programRuleActionType: string
    content?: string
    program?: { id: string }
    dataElement?: { id: string }
    trackedEntityAttribute?: { id: string }
}

export interface ProgramRuleVariable {
    id: string | null
    name: string
    program?: { id: string }
    programRuleVariableSourceType?: string
    dataElement?: { id: string }
    trackedEntityAttribute?: { id: string }
    programStage?: { id: string }
    valueType?: string
}

export interface DataElementRef {
    id: string
    name: string
    valueType: string
    /** Present when the field is bound to an option set (its values are then
     * constrained to the option list, so numeric range validation is moot). */
    optionSet?: { id: string } | null
}

export interface ProgramStage {
    id: string
    name: string
    executionDateLabel?: string
    hideDueDate?: boolean
    programStageDataElements?: { dataElement?: DataElementRef }[]
}

export interface ProgramMetadata {
    id: string
    name: string
    enrollmentDateLabel?: string
    incidentDateLabel?: string
    displayIncidentDate?: boolean
    programStages?: ProgramStage[]
    programTrackedEntityAttributes?: {
        trackedEntityAttribute?: DataElementRef
    }[]
    programRules: ProgramRule[]
    programRuleVariables: ProgramRuleVariable[]
    programRuleActions: ProgramRuleAction[]
}

export type DateOperator =
    | 'before'
    | 'after'
    | 'on_or_after'
    | 'on_or_before'
    | 'within_before'
    | 'within_after'
    | 'between'

export type NumericOperator =
    | 'greater_than'
    | 'greater_than_or_equal'
    | 'less_than'
    | 'less_than_or_equal'
    | 'equal_to'
    | 'not_equal_to'
    | 'between'

export type ComparisonDateMode = 'variable' | 'fixed' | 'current' | 'relative'

/**
 * A validation configuration collected from the form or a batch template.
 * Date validations use `operator` + comparison fields; numeric validations
 * use `numericOperator` + `numericComparisonType`.
 */
export interface ValidationConfig {
    // date
    operator?: DateOperator | string
    comparisonDateMode?: ComparisonDateMode
    /** "type:id[:stageId]" key of the comparison variable (mode "variable") */
    comparisonDate?: string
    fixedComparisonDate?: string
    relativeComparisonAmount?: number | null
    relativeComparisonUnit?: string
    relativeComparisonDirection?: RelativeDirection
    intervalAmount?: number | null
    intervalUnit?: string
    // date "between": the lower bound reuses the comparison* fields above;
    // the upper bound uses this parallel set.
    upperComparisonDateMode?: ComparisonDateMode
    upperComparisonDate?: string
    upperFixedComparisonDate?: string
    upperRelativeComparisonAmount?: number | null
    upperRelativeComparisonUnit?: string
    upperRelativeComparisonDirection?: RelativeDirection
    // numeric
    numericOperator?: NumericOperator | string
    numericComparisonType?: 'value' | 'field'
    numericValue?: number | null
    /** upper bound for numeric "between" (numericValue is the lower bound) */
    numericValueMax?: number | null
    /** "type:id[:stageId]" key of the comparison field (type "field") */
    numericComparisonField?: string
    // rule fields
    ruleName?: string
    ruleDescription?: string
    ruleMessage?: string
    actionType?: RuleActionType | string
}

export type BatchScope = 'programme' | 'stage'

export interface BatchTemplate extends ValidationConfig {
    category: VariableCategory
    scope: BatchScope
    stageId?: string | null
}

export interface ExistingValidation {
    rule: ProgramRule
    actions: ProgramRuleAction[]
}

export interface ParsedRuleCondition {
    variable1: Variable
    variable2: Variable | null
    /** upper bound for "between" rules (variable2 is then the lower bound) */
    variable3?: Variable | null
    config: ValidationConfig & {
        value?: number
        valueMax?: number
        comparisonType?: string
    }
}
