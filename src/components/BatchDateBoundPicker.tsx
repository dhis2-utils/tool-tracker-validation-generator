import i18n from '@dhis2/d2-i18n'
import { InputField, SingleSelectField, SingleSelectOption } from '@dhis2/ui'
import styles from './BatchWorkspace.module.css'
import type { RelativeDirection } from '@/lib/types'

type BoundMode = 'fixed' | 'current' | 'relative'

interface BatchDateBoundPickerProps {
    mode: BoundMode
    onModeChange: (mode: BoundMode) => void
    fixedDate: string
    onFixedDateChange: (value: string) => void
    relativeAmount: string
    onRelativeAmountChange: (value: string) => void
    relativeDirection: RelativeDirection
    onRelativeDirectionChange: (value: RelativeDirection) => void
}

/**
 * A batch (template) date bound: a fixed date, the current date, or a
 * day-relative offset from the current date. Rendered once for a normal
 * comparison and twice (lower + upper) for "between". Unlike the per-field
 * picker it never compares to another tracked variable, since a template
 * applies across many variables. Days only (the rule engine has d2:addDays but
 * not d2:addYears/d2:addMonths).
 */
export const BatchDateBoundPicker = ({
    mode,
    onModeChange,
    fixedDate,
    onFixedDateChange,
    relativeAmount,
    onRelativeAmountChange,
    relativeDirection,
    onRelativeDirectionChange,
}: BatchDateBoundPickerProps) => (
    <>
        <SingleSelectField
            dense
            className={styles.inlineSelect}
            selected={mode}
            onChange={({ selected }: { selected: string }) =>
                onModeChange(selected as BoundMode)
            }
        >
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
                <span className={styles.connector}>{i18n.t('days')}</span>
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
