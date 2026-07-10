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
import styles from './ValidationForm.module.css'
import type { RelativeDirection, ValidationConfig, Variable } from '@/lib/types'
import {
    getDateComparisonOptions,
    getNumericFieldOptions,
    getValidationPreview,
    isConfigComplete,
} from '@/lib/validation'
import { getVariableKey } from '@/lib/variables'
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
        initialConfig?.relativeComparisonUnit || 'years'
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
            ? parseInt(relativeAmount, 10)
            : null,
        relativeComparisonUnit: relativeUnit,
        relativeComparisonDirection: relativeDirection,
        intervalAmount: intervalAmount ? parseInt(intervalAmount, 10) : null,
        intervalUnit,
        numericOperator,
        numericComparisonType,
        numericValue: numericValue !== '' ? parseFloat(numericValue) : null,
        numericComparisonField,
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
                ? parseInt(relativeAmount, 10)
                : null,
        ruleName: effectiveRuleName,
        ruleDescription: effectiveDescription,
        ruleMessage: effectiveMessage,
        actionType,
    }

    const settingsConfigured = Boolean(
        programConfig?.programRuleVariablePrefix?.trim()
    )
    const isValid =
        settingsConfigured && isConfigComplete(variable, finalConfig)

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
                    <span className={styles.varName}>{variable.name}</span>
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
                    <SingleSelectField
                        dense
                        className={styles.inlineSelect}
                        selected={comparisonDateMode}
                        onChange={({ selected }: { selected: string }) =>
                            setComparisonDateMode(
                                selected as
                                    | 'variable'
                                    | 'fixed'
                                    | 'current'
                                    | 'relative'
                            )
                        }
                    >
                        <SingleSelectOption
                            value="variable"
                            label={i18n.t('another tracked date')}
                        />
                        <SingleSelectOption
                            value="fixed"
                            label={i18n.t('a fixed date')}
                        />
                        <SingleSelectOption
                            value="current"
                            label={i18n.t('the current date')}
                        />
                        <SingleSelectOption
                            value="relative"
                            label={i18n.t('relative to the current date')}
                        />
                    </SingleSelectField>
                    {comparisonDateMode === 'variable' && (
                        <SingleSelectField
                            dense
                            className={styles.inlineSelect}
                            placeholder={i18n.t('Choose date...')}
                            selected={
                                dateOptions.some(
                                    (v) => getVariableKey(v) === comparisonDate
                                )
                                    ? comparisonDate
                                    : undefined
                            }
                            onChange={({ selected }: { selected: string }) =>
                                setComparisonDate(selected)
                            }
                        >
                            {dateOptions.map((option) => (
                                <SingleSelectOption
                                    key={getVariableKey(option)}
                                    value={getVariableKey(option)}
                                    label={option.name}
                                />
                            ))}
                        </SingleSelectField>
                    )}
                    {comparisonDateMode === 'fixed' && (
                        <InputField
                            dense
                            className={styles.inlineDate}
                            type="date"
                            value={fixedComparisonDate}
                            onChange={({ value }: { value?: string }) =>
                                setFixedComparisonDate(value ?? '')
                            }
                        />
                    )}
                    {comparisonDateMode === 'relative' && (
                        <>
                            <span className={styles.connector}>
                                {i18n.t('offset by')}
                            </span>
                            <InputField
                                dense
                                className={styles.inlineNumber}
                                type="number"
                                min="1"
                                placeholder="1"
                                value={relativeAmount}
                                onChange={({ value }: { value?: string }) =>
                                    setRelativeAmount(value ?? '')
                                }
                            />
                            <SingleSelectField
                                dense
                                className={styles.inlineUnit}
                                selected={relativeUnit}
                                onChange={({
                                    selected,
                                }: {
                                    selected: string
                                }) => setRelativeUnit(selected)}
                            >
                                <SingleSelectOption
                                    value="days"
                                    label={i18n.t('days')}
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
                            <SingleSelectField
                                dense
                                className={styles.inlineUnit}
                                selected={relativeDirection}
                                onChange={({
                                    selected,
                                }: {
                                    selected: string
                                }) =>
                                    setRelativeDirection(
                                        selected as RelativeDirection
                                    )
                                }
                            >
                                <SingleSelectOption
                                    value="past"
                                    label={i18n.t('in the past')}
                                />
                                <SingleSelectOption
                                    value="future"
                                    label={i18n.t('in the future')}
                                />
                            </SingleSelectField>
                        </>
                    )}
                </div>
            ) : (
                <div className={styles.ruleBuilder}>
                    <span className={styles.varName}>{variable.name}</span>
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
                    </SingleSelectField>
                    <SingleSelectField
                        dense
                        className={styles.inlineSelect}
                        selected={numericComparisonType}
                        onChange={({ selected }: { selected: string }) =>
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
                            onChange={({ selected }: { selected: string }) =>
                                setNumericComparisonField(selected)
                            }
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

            <ButtonStrip>
                <Button
                    primary
                    disabled={!isValid || busy}
                    loading={busy}
                    onClick={() => onSubmit(finalConfig)}
                >
                    {editing
                        ? i18n.t('Update validation rule')
                        : i18n.t('Create validation rule')}
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
