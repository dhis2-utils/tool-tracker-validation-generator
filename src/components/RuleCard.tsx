import i18n from '@dhis2/d2-i18n'
import { Button, ButtonStrip, Tag } from '@dhis2/ui'
import styles from './RuleCard.module.css'
import { FEEDBACK_ACTION_TYPES } from '@/lib/detector'
import type { ExistingValidation } from '@/lib/types'

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
    const action = validation.actions.find((a) =>
        FEEDBACK_ACTION_TYPES.includes(a.programRuleActionType)
    )
    const actionType = action ? action.programRuleActionType : 'UNKNOWN'
    const isError = actionType.includes('ERROR')

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
                {action?.content && (
                    <>
                        <dt>{i18n.t('Message')}</dt>
                        <dd>{action.content}</dd>
                    </>
                )}
            </dl>
            <ButtonStrip>
                {isEditable && onEdit && (
                    <Button small secondary onClick={onEdit} disabled={busy}>
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
