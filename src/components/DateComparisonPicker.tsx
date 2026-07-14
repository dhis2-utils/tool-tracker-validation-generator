import i18n from '@dhis2/d2-i18n'
import { InputField, SingleSelectField, SingleSelectOption } from '@dhis2/ui'
import styles from './ValidationForm.module.css'
import type {
    ComparisonDateMode,
    RelativeDirection,
    Variable,
} from '@/lib/types'
import { getVariableKey } from '@/lib/variables'

interface DateComparisonPickerProps {
    mode: ComparisonDateMode
    onModeChange: (mode: ComparisonDateMode) => void
    comparisonDate: string
    onComparisonDateChange: (value: string) => void
    fixedDate: string
    onFixedDateChange: (value: string) => void
    relativeAmount: string
    onRelativeAmountChange: (value: string) => void
    relativeUnit: string
    onRelativeUnitChange: (value: string) => void
    relativeDirection: RelativeDirection
    onRelativeDirectionChange: (value: RelativeDirection) => void
    dateOptions: Variable[]
}

/**
 * The comparison-target picker for a date rule: a mode select (another tracked
 * date / fixed date / current date / relative) plus the input that mode needs.
 * Rendered once for a normal comparison and twice (lower + upper) for "between".
 */
export const DateComparisonPicker = ({
    mode,
    onModeChange,
    comparisonDate,
    onComparisonDateChange,
    fixedDate,
    onFixedDateChange,
    relativeAmount,
    onRelativeAmountChange,
    relativeUnit,
    onRelativeUnitChange,
    relativeDirection,
    onRelativeDirectionChange,
    dateOptions,
}: DateComparisonPickerProps) => (
    <>
        <SingleSelectField
            dense
            className={styles.inlineSelect}
            selected={mode}
            onChange={({ selected }: { selected: string }) =>
                onModeChange(selected as ComparisonDateMode)
            }
        >
            <SingleSelectOption
                value="variable"
                label={i18n.t('another tracked date')}
            />
            <SingleSelectOption value="fixed" label={i18n.t('a fixed date')} />
            <SingleSelectOption
                value="current"
                label={i18n.t('the current date')}
            />
            <SingleSelectOption
                value="relative"
                label={i18n.t('relative to the current date')}
            />
        </SingleSelectField>
        {mode === 'variable' && (
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
                    onComparisonDateChange(selected)
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
        {mode === 'fixed' && (
            <InputField
                dense
                className={styles.inlineDate}
                type="date"
                value={fixedDate}
                onChange={({ value }: { value?: string }) =>
                    onFixedDateChange(value ?? '')
                }
            />
        )}
        {mode === 'relative' && (
            <>
                <span className={styles.connector}>{i18n.t('offset by')}</span>
                <InputField
                    dense
                    className={styles.inlineNumber}
                    type="number"
                    min="1"
                    placeholder="1"
                    error={!relativeAmount}
                    value={relativeAmount}
                    onChange={({ value }: { value?: string }) =>
                        onRelativeAmountChange(value ?? '')
                    }
                />
                {/* Only "days" is offered: the DHIS2 program-rule engine has
                    d2:addDays but no d2:addYears/d2:addMonths, so months/years
                    relative bounds would silently never fire. */}
                <SingleSelectField
                    dense
                    className={styles.inlineUnit}
                    selected={relativeUnit}
                    onChange={({ selected }: { selected: string }) =>
                        onRelativeUnitChange(selected)
                    }
                >
                    <SingleSelectOption value="days" label={i18n.t('days')} />
                </SingleSelectField>
                <SingleSelectField
                    dense
                    className={styles.inlineUnit}
                    selected={relativeDirection}
                    onChange={({ selected }: { selected: string }) =>
                        onRelativeDirectionChange(selected as RelativeDirection)
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
    </>
)
