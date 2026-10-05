import i18n from '@dhis2/d2-i18n'
import type { ConfigError } from '@/lib/validation'

/** User-facing text for configs that would reject every value. */
export const configErrorMessage = (error: ConfigError): string => {
    switch (error) {
        case 'MIN_GREATER_THAN_MAX':
            return i18n.t(
                'The minimum is greater than the maximum, so every value would be rejected.'
            )
        case 'EMPTY_DATE_RANGE':
            return i18n.t(
                'The lower date bound is after the upper bound, so every date would be rejected.'
            )
        case 'INTERVAL_TOO_SMALL':
            return i18n.t('The interval must be a whole number of at least 1.')
        case 'OFFSET_TOO_SMALL':
            return i18n.t(
                'The number of days must be a whole number of at least 1.'
            )
    }
}
