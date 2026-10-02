import i18n from '@dhis2/d2-i18n'
import {
    Button,
    ButtonStrip,
    InputField,
    NoticeBox,
    SingleSelectField,
    SingleSelectOption,
    TextAreaField,
} from '@dhis2/ui'
import { useState } from 'react'
import { configErrorMessage } from './configErrorMessages'
import { DateComparisonPicker } from './DateComparisonPicker'
import styles from './ValidationForm.module.css'
import type {
    ComparisonDateMode,
    RelativeDirection,
    ValidationConfig,
    Variable,
} from '@/lib/types'
import {
    getConfigErrors,
    getDateComparisonOptions,
    getMissingFieldLabels,
    getNumericFieldOptions,
    getValidationPreview,
    ruleRejectsFutureDates,
} from '@/lib/validation'
import { getVariableKey, VALUE_TYPE_LABELS } from '@/lib/variables'
import type { ProgramConfig } from '@/services/rules'

const ACTION_TYPE_OPTIONS = [
    { value: 'SHOWERROR', label: () => i18n.t('Error — block save') },
    { value: 'SHOWWARNING', label: () => i18n.t('Warning — allow save') },
    { value: 'ERRORONCOMPLETE', label: () => i18n.t('Error on complete') },
    { value: 'WARNINGONCOMPLETE', label: () => i18n.t('Warning on complete') },
]

interface ValidationFormProps {
    variable: Variable
    variables: Variable[]
    programConfig: ProgramConfig | null
    /** Prefilled config when editing an existing rule */
    initialConfig?: ValidationConfig | null
    editing: boolean
    busy: boolean
    onSubmit: (config: ValidationConfig) => void
    onCancelEdit?: () => void
    /** Hide the per-rule name/description/message fields (used for group edits
     * where those are regenerated per variable). */
    hideRuleFields?: boolean
    /** Override the submit button label. */
    submitLabel?: string
}

export const ValidationForm = ({
    variable,
    variables,
    programConfig,
    initialConfig = null,
    editing,
    busy,
    onSubmit,
    onCancelEdit,
    hideRuleFields = false,
    submitLabel,
}: ValidationFormProps) => {
    const isNumeric = variable.category === 'numeric'

    // builder state
    const [operator, setOperator] = useState<string | undefined>(
        (initialConfig?.operator as string) || undefined
    )
    const [comparisonDateMode, setComparisonDateMode] = useState(
        initialConfig?.comparisonDateMode || 'variable'
    )
    const [comparisonDate, setComparisonDate] = useState(
        initialConfig?.comparisonDate || ''
    )
    const [fixedComparisonDate, setFixedComparisonDate] = useState(
        initialConfig?.fixedComparisonDate || ''
    )
    const [relativeAmount, setRelativeAmount] = useState(
        initialConfig?.relativeComparisonAmount != null
            ? String(initialConfig.relativeComparisonAmount)
            : ''
    )
    const [relativeUnit, setRelativeUnit] = useState(
        initialConfig?.relativeComparisonUnit || 'days'
    )
    const [relativeDirection, setRelativeDirection] =
        useState<RelativeDirection>(
            initialConfig?.relativeComparisonDirection || 'past'
        )
    const [intervalAmount, setIntervalAmount] = useState(
        initialConfig?.intervalAmount != null
            ? String(initialConfig.intervalAmount)
            : ''
    )
    const [intervalUnit, setIntervalUnit] = useState(
        initialConfig?.intervalUnit || 'days'
    )
    const [numericOperator, setNumericOperator] = useState<string | undefined>(
        (initialConfig?.numericOperator as string) || undefined
    )
    const [numericComparisonType, setNumericComparisonType] = useState<
        'value' | 'field'
    >(initialConfig?.numericComparisonType || 'value')
    const [numericValue, setNumericValue] = useState(
        initialConfig?.numericValue != null
            ? String(initialConfig.numericValue)
            : ''
    )
    const [numericComparisonField, setNumericComparisonField] = useState(
        initialConfig?.numericComparisonField || ''
    )
    const [numericValueMax, setNumericValueMax] = useState(
        initialConfig?.numericValueMax != null
            ? String(initialConfig.numericValueMax)
            : ''
    )
    // upper bound for a date "between" (lower bound reuses the state above)
    const [upperComparisonDateMode, setUpperComparisonDateMode] =
        useState<ComparisonDateMode>(
            initialConfig?.upperComparisonDateMode || 'current'
        )
    const [upperComparisonDate, setUpperComparisonDate] = useState(
        initialConfig?.upperComparisonDate || ''
    )
    const [upperFixedComparisonDate, setUpperFixedComparisonDate] = useState(
        initialConfig?.upperFixedComparisonDate || ''
    )
    const [upperRelativeAmount, setUpperRelativeAmount] = useState(
        initialConfig?.upperRelativeComparisonAmount != null
            ? String(initialConfig.upperRelativeComparisonAmount)
            : ''
    )
    const [upperRelativeUnit, setUpperRelativeUnit] = useState(
        initialConfig?.upperRelativeComparisonUnit || 'days'
    )
    const [upperRelativeDirection, setUpperRelativeDirection] =
        useState<RelativeDirection>(
            initialConfig?.upperRelativeComparisonDirection || 'past'
        )

    // Name/description/message: null = follow the generated suggestion
    const [ruleName, setRuleName] = useState<string | null>(
        initialConfig?.ruleName ?? null
    )
    const [ruleDescription, setRuleDescription] = useState<string | null>(
        initialConfig?.ruleDescription ?? null
    )
    const [ruleMessage, setRuleMessage] = useState<string | null>(
        initialConfig?.ruleMessage ?? null
    )
    const [actionType, setActionType] = useState(
        initialConfig?.actionType || 'SHOWERROR'
    )

    const isInterval =
        operator === 'within_before' || operator === 'within_after'

    const builderConfig: ValidationConfig = {
        operator,
        comparisonDateMode,
        comparisonDate,
        fixedComparisonDate,
        relativeComparisonAmount: relativeAmount
            ? Number(relativeAmount)
            : null,
        relativeComparisonUnit: relativeUnit,
        relativeComparisonDirection: relativeDirection,
        intervalAmount: intervalAmount ? Number(intervalAmount) : null,
        intervalUnit,
        numericOperator,
        numericComparisonType,
        numericValue: numericValue !== '' ? parseFloat(numericValue) : null,
        numericValueMax:
            numericValueMax !== '' ? parseFloat(numericValueMax) : null,
        numericComparisonField,
        upperComparisonDateMode,
        upperComparisonDate,
        upperFixedComparisonDate,
        upperRelativeComparisonAmount: upperRelativeAmount
            ? Number(upperRelativeAmount)
            : null,
        upperRelativeComparisonUnit: upperRelativeUnit,
        upperRelativeComparisonDirection: upperRelativeDirection,
    }

    const suggestions = getValidationPreview(variable, builderConfig, variables)
    const effectiveRuleName = ruleName ?? suggestions.suggestedRuleName
    const effectiveDescription =
        ruleDescription ?? suggestions.suggestedDescription
    const effectiveMessage = ruleMessage ?? suggestions.suggestedMessage

    const finalConfig: ValidationConfig = {
        ...builderConfig,
        comparisonDate: comparisonDateMode === 'variable' ? comparisonDate : '',
        fixedComparisonDate:
            comparisonDateMode === 'fixed' ? fixedComparisonDate : '',
        relativeComparisonAmount:
            comparisonDateMode === 'relative' && relativeAmount
                ? Number(relativeAmount)
                : null,
        ruleName: effectiveRuleName,
        ruleDescription: effectiveDescription,
        ruleMessage: effectiveMessage,
        actionType,
    }

    const settingsConfigured = Boolean(
        programConfig?.programRuleVariablePrefix?.trim()
    )
    const missingFields = getMissingFieldLabels(variable, finalConfig)
    const configErrors = getConfigErrors(variable, finalConfig)
    const isValid =
        settingsConfigured &&
        missingFields.length === 0 &&
        configErrors.length === 0
    // Warn (don't block) when the rule rejects future dates on a field that is
    // explicitly configured to allow them.
    const futureDatesContradiction =
        Boolean(variable.futureDatesAllowed) &&
        ruleRejectsFutureDates(finalConfig)

    const dateOptions = getDateComparisonOptions(variable, variables)
    const numericFieldOptions = getNumericFieldOptions(variable, variables)

    return (
        <div className={styles.form}>
            {!settingsConfigured && (
                <NoticeBox warning title={i18n.t('Settings required')}>
                    {i18n.t(
                        'Please configure programme settings first (using the Programme settings button above).'
                    )}
                </NoticeBox>
            )}

            {!isNumeric ? (
                <div className={styles.ruleBuilder}>
                    <span className={styles.varName}>
                        {variable.name}
                        {VALUE_TYPE_LABELS[variable.valueType ?? '']
                            ? ` (${VALUE_TYPE_LABELS[variable.valueType ?? '']})`
                            : ''}
                    </span>
                    <span className={styles.connector}>
                        {i18n.t('should be')}
                    </span>
                    <SingleSelectField
                        dense
                        className={styles.inlineSelect}
                        placeholder={i18n.t('Choose relationship...')}
                        selected={operator}
                        onChange={({ selected }: { selected: string }) =>
                            setOperator(selected)
                        }
                    >
                        <SingleSelectOption
                            value="before"
                            label={i18n.t('before')}
                        />
                        <SingleSelectOption
                            value="after"
                            label={i18n.t('after')}
                        />
                        <SingleSelectOption
                            value="on_or_after"
                            label={i18n.t('on or after')}
                        />
                        <SingleSelectOption
                            value="on_or_before"
                            label={i18n.t('on or before')}
                        />
                        <SingleSelectOption
                            value="within_before"
                            label={i18n.t('within ... before')}
                        />
                        <SingleSelectOption
                            value="within_after"
                            label={i18n.t('within ... after')}
                        />
                        <SingleSelectOption
                            value="between"
                            label={i18n.t('between')}
                        />
                    </SingleSelectField>
                    {isInterval && (
                        <>
                            <InputField
                                dense
                                className={styles.inlineNumber}
                                type="number"
                                min="1"
                                placeholder="30"
                                value={intervalAmount}
                                onChange={({ value }: { value?: string }) =>
                                    setIntervalAmount(value ?? '')
                                }
                            />
                            <SingleSelectField
                                dense
                                className={styles.inlineUnit}
                                selected={intervalUnit}
                                onChange={({
                                    selected,
                                }: {
                                    selected: string
                                }) => setIntervalUnit(selected)}
                            >
                                <SingleSelectOption
                                    value="days"
                                    label={i18n.t('days')}
                                />
                                <SingleSelectOption
                                    value="weeks"
                                    label={i18n.t('weeks')}
                                />
                                <SingleSelectOption
                                    value="months"
                                    label={i18n.t('months')}
                                />
                                <SingleSelectOption
                                    value="years"
                                    label={i18n.t('years')}
                                />
                            </SingleSelectField>
                            <span className={styles.connector}>
                                {operator === 'within_before'
                                    ? i18n.t('before')
                                    : i18n.t('after')}
                            </span>
                        </>
                    )}
                    <DateComparisonPicker
                        mode={comparisonDateMode}
                        onModeChange={setComparisonDateMode}
                        comparisonDate={comparisonDate}
                        onComparisonDateChange={setComparisonDate}
                        fixedDate={fixedComparisonDate}
                        onFixedDateChange={setFixedComparisonDate}
                        relativeAmount={relativeAmount}
                        onRelativeAmountChange={setRelativeAmount}
                        relativeUnit={relativeUnit}
                        onRelativeUnitChange={setRelativeUnit}
                        relativeDirection={relativeDirection}
                        onRelativeDirectionChange={setRelativeDirection}
                        dateOptions={dateOptions}
                    />
                    {operator === 'between' && (
                        <>
                            <span className={styles.connector}>
                                {i18n.t('and')}
                            </span>
                            <DateComparisonPicker
                                mode={upperComparisonDateMode}
                                onModeChange={setUpperComparisonDateMode}
                                comparisonDate={upperComparisonDate}
                                onComparisonDateChange={setUpperComparisonDate}
                                fixedDate={upperFixedComparisonDate}
                                onFixedDateChange={setUpperFixedComparisonDate}
                                relativeAmount={upperRelativeAmount}
                                onRelativeAmountChange={setUpperRelativeAmount}
                                relativeUnit={upperRelativeUnit}
                                onRelativeUnitChange={setUpperRelativeUnit}
                                relativeDirection={upperRelativeDirection}
                                onRelativeDirectionChange={
                                    setUpperRelativeDirection
                                }
                                dateOptions={dateOptions}
                            />
                            <span className={styles.connector}>
                                {i18n.t('(both included)')}
                            </span>
                        </>
                    )}
                </div>
            ) : (
                <div className={styles.ruleBuilder}>
                    <span className={styles.varName}>
                        {variable.name}
                        {VALUE_TYPE_LABELS[variable.valueType ?? '']
                            ? ` (${VALUE_TYPE_LABELS[variable.valueType ?? '']})`
                            : ''}
                    </span>
                    <span className={styles.connector}>
                        {i18n.t('should be')}
                    </span>
                    <SingleSelectField
                        dense
                        className={styles.inlineSelect}
                        placeholder={i18n.t('Choose operator...')}
                        selected={numericOperator}
                        onChange={({ selected }: { selected: string }) =>
                            setNumericOperator(selected)
                        }
                    >
                        <SingleSelectOption
                            value="less_than"
                            label={i18n.t('less than')}
                        />
                        <SingleSelectOption
                            value="less_than_or_equal"
                            label={i18n.t('less than or equal to')}
                        />
                        <SingleSelectOption
                            value="greater_than"
                            label={i18n.t('greater than')}
                        />
                        <SingleSelectOption
                            value="greater_than_or_equal"
                            label={i18n.t('greater than or equal to')}
                        />
                        <SingleSelectOption
                            value="equal_to"
                            label={i18n.t('equal to')}
                        />
                        <SingleSelectOption
                            value="not_equal_to"
                            label={i18n.t('not equal to')}
                        />
                        <SingleSelectOption
                            value="between"
                            label={i18n.t('between')}
                        />
                    </SingleSelectField>
                    {numericOperator === 'between' ? (
                        <>
                            <InputField
                                dense
                                className={styles.inlineNumber}
                                type="number"
                                step="0.01"
                                placeholder={i18n.t('min')}
                                error={numericValue === ''}
                                value={numericValue}
                                onChange={({ value }: { value?: string }) =>
                                    setNumericValue(value ?? '')
                                }
                            />
                            <span className={styles.connector}>
                                {i18n.t('and')}
                            </span>
                            <InputField
                                dense
                                className={styles.inlineNumber}
                                type="number"
                                step="0.01"
                                placeholder={i18n.t('max')}
                                error={numericValueMax === ''}
                                value={numericValueMax}
                                onChange={({ value }: { value?: string }) =>
                                    setNumericValueMax(value ?? '')
                                }
                            />
                            <span className={styles.connector}>
                                {i18n.t('(both included)')}
                            </span>
                        </>
                    ) : (
                        <>
                            <SingleSelectField
                                dense
                                className={styles.inlineSelect}
                                selected={numericComparisonType}
                                onChange={({
                                    selected,
                                }: {
                                    selected: string
                                }) =>
                                    setNumericComparisonType(
                                        selected as 'value' | 'field'
                                    )
                                }
                            >
                                <SingleSelectOption
                                    value="value"
                                    label={i18n.t('a fixed value')}
                                />
                                <SingleSelectOption
                                    value="field"
                                    label={i18n.t('another field')}
                                />
                            </SingleSelectField>
                            {numericComparisonType === 'value' ? (
                                <InputField
                                    dense
                                    className={styles.inlineNumber}
                                    type="number"
                                    step="0.01"
                                    placeholder={i18n.t('e.g. 100')}
                                    value={numericValue}
                                    onChange={({ value }: { value?: string }) =>
                                        setNumericValue(value ?? '')
                                    }
                                />
                            ) : (
                                <SingleSelectField
                                    dense
                                    className={styles.inlineSelect}
                                    placeholder={i18n.t('Choose field...')}
                                    selected={
                                        numericFieldOptions.some(
                                            (v) =>
                                                getVariableKey(v) ===
                                                numericComparisonField
                                        )
                                            ? numericComparisonField
                                            : undefined
                                    }
                                    onChange={({
                                        selected,
                                    }: {
                                        selected: string
                                    }) => setNumericComparisonField(selected)}
                                >
                                    {numericFieldOptions.map((option) => (
                                        <SingleSelectOption
                                            key={getVariableKey(option)}
                                            value={getVariableKey(option)}
                                            label={option.name}
                                        />
                                    ))}
                                </SingleSelectField>
                            )}
                        </>
                    )}
                </div>
            )}

            <div className={styles.previewPanel}>
                <span className={styles.previewLabel}>{i18n.t('Preview')}</span>
                <span>
                    {suggestions.preview ||
                        i18n.t(
                            'Configure the validation above to see a preview'
                        )}
                </span>
            </div>

            {!hideRuleFields && (
                <>
                    <InputField
                        label={i18n.t('Rule name')}
                        placeholder={i18n.t(
                            'e.g. Birth date must be before enrollment date'
                        )}
                        helpText={i18n.t(
                            'A descriptive name for administrators to identify this rule'
                        )}
                        required
                        value={effectiveRuleName}
                        onChange={({ value }: { value?: string }) =>
                            setRuleName(value ?? '')
                        }
                    />
                    <TextAreaField
                        label={i18n.t('Rule description (optional)')}
                        placeholder={i18n.t(
                            'Additional details about this validation rule for administrators'
                        )}
                        value={effectiveDescription}
                        onChange={({ value }: { value?: string }) =>
                            setRuleDescription(value ?? '')
                        }
                    />
                    <TextAreaField
                        label={i18n.t('Validation message')}
                        placeholder={i18n.t(
                            'e.g. Birth date cannot be after enrollment date'
                        )}
                        helpText={i18n.t(
                            'Message shown to users when validation fails'
                        )}
                        required
                        value={effectiveMessage}
                        onChange={({ value }: { value?: string }) =>
                            setRuleMessage(value ?? '')
                        }
                    />
                </>
            )}
            <div className={styles.actionTypeRow}>
                <SingleSelectField
                    dense
                    label={i18n.t('Action type')}
                    helpText={i18n.t(
                        'How DHIS2 should respond when validation fails'
                    )}
                    selected={actionType as string}
                    onChange={({ selected }: { selected: string }) =>
                        setActionType(selected)
                    }
                >
                    {ACTION_TYPE_OPTIONS.map((option) => (
                        <SingleSelectOption
                            key={option.value}
                            value={option.value}
                            label={option.label()}
                        />
                    ))}
                </SingleSelectField>
            </div>

            {futureDatesContradiction && (
                <NoticeBox
                    warning
                    title={i18n.t('This field allows future dates')}
                >
                    {i18n.t(
                        '“{{name}}” is configured to allow future dates, but this rule rejects dates after the current date — the rule contradicts the field’s configuration.',
                        { name: variable.name, nsSeparator: undefined }
                    )}
                </NoticeBox>
            )}

            {configErrors.length > 0 && (
                <NoticeBox error title={i18n.t('This rule cannot be saved')}>
                    {configErrors.map((error) => (
                        <p key={error}>{configErrorMessage(error)}</p>
                    ))}
                </NoticeBox>
            )}

            {settingsConfigured && missingFields.length > 0 && (
                <NoticeBox
                    warning
                    title={i18n.t('Complete these fields before saving')}
                >
                    {missingFields.join(', ')}
                </NoticeBox>
            )}

            <ButtonStrip>
                <Button
                    primary
                    disabled={!isValid || busy}
                    loading={busy}
                    onClick={() => onSubmit(finalConfig)}
                >
                    {submitLabel ??
                        (editing
                            ? i18n.t('Update validation rule')
                            : i18n.t('Create validation rule'))}
                </Button>
                {editing && onCancelEdit && (
                    <Button secondary onClick={onCancelEdit} disabled={busy}>
                        {i18n.t('Cancel editing')}
                    </Button>
                )}
            </ButtonStrip>
        </div>
    )
}
