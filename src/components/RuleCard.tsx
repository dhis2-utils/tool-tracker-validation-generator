import i18n from '@dhis2/d2-i18n'
import { Button, ButtonStrip, Tag } from '@dhis2/ui'
import styles from './RuleCard.module.css'
import type { ExistingValidation } from '@/lib/types'

/** Why the app won't edit this rule, or null when it can. The app edits one
 * message per rule; a rule with several is left to the Maintenance app. */
export const editBlockedReason = (
    validation: ExistingValidation
): string | null =>
    validation.actions.length > 1
        ? i18n.t(
              'This rule has more than one message, so it can only be edited in the Maintenance app.'
          )
        : null

export const RuleCard = ({
    validation,
    isEditable,
    onEdit,
    onDelete,
    busy,
}: {
    validation: ExistingValidation
    isEditable: boolean
    onEdit?: () => void
    onDelete: () => void
    busy: boolean
}) => {
    const [first] = validation.actions
    const actionType = first ? first.programRuleActionType : 'UNKNOWN'
    const isError = actionType.includes('ERROR')
    const blocked = isEditable ? editBlockedReason(validation) : null

    return (
        <div
            className={`${styles.ruleCard} ${isError ? styles.error : styles.warning}`}
        >
            <div className={styles.ruleHeader}>
                <h4>{validation.rule.name}</h4>
                <Tag negative={isError} neutral={!isError}>
                    {actionType}
                </Tag>
            </div>
            <dl className={styles.ruleMeta}>
                <dt>{i18n.t('Rule ID')}</dt>
                <dd>
                    <code>{validation.rule.id}</code>
                </dd>
                <dt>{i18n.t('Condition')}</dt>
                <dd>
                    <code>{validation.rule.condition}</code>
                </dd>
                {validation.actions
                    .filter((action) => action.content)
                    .map((action) => (
                        <div key={action.id} className={styles.metaRow}>
                            <dt>
                                {validation.actions.length > 1
                                    ? `${i18n.t('Message')} (${action.programRuleActionType})`
                                    : i18n.t('Message')}
                            </dt>
                            <dd>{action.content}</dd>
                        </div>
                    ))}
            </dl>
            {blocked && <p className={styles.blockedNote}>{blocked}</p>}
            <ButtonStrip>
                {isEditable && onEdit && (
                    <Button
                        small
                        secondary
                        onClick={onEdit}
                        disabled={busy || Boolean(blocked)}
                    >
                        {i18n.t('Edit')}
                    </Button>
                )}
                <Button small destructive onClick={onDelete} disabled={busy}>
                    {i18n.t('Delete')}
                </Button>
            </ButtonStrip>
        </div>
    )
}
