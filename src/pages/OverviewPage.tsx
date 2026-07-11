import i18n from '@dhis2/d2-i18n'
import { CircularLoader, NoticeBox } from '@dhis2/ui'
import { useParams } from 'react-router-dom'
import styles from './OverviewPage.module.css'
import { BatchWorkspace } from '@/components/BatchWorkspace'
import { VariableList } from '@/components/VariableList'
import { useProgramData } from '@/hooks/useProgramData'
import { useValidationActions } from '@/hooks/useValidationActions'

export const OverviewPage = () => {
    const { programId } = useParams()
    const { programMetadata, config, variables, isLoading, error } =
        useProgramData(programId)
    const { applyBatch, isApplyingBatch, batchProgress } = useValidationActions(
        {
            programId: programId as string,
            programMetadata,
            config,
            variables,
        }
    )

    if (isLoading) {
        return (
            <div className={styles.loadingContainer}>
                <CircularLoader />
                <p>{i18n.t('Loading programme metadata...')}</p>
            </div>
        )
    }

    if (error) {
        return (
            <NoticeBox error title={i18n.t('Error loading programme')}>
                {error.message || i18n.t('An unknown error occurred')}
            </NoticeBox>
        )
    }

    if (!programMetadata) {
        return null
    }

    const settingsConfigured = Boolean(
        config?.programRuleVariablePrefix?.trim()
    )

    return (
        <div className={styles.page}>
            <h2 className={styles.heading}>{i18n.t('Variables')}</h2>
            {!settingsConfigured && (
                <NoticeBox warning title={i18n.t('Settings required')}>
                    {i18n.t(
                        'Please configure programme settings (using the Programme settings button above) before creating validation rules.'
                    )}
                </NoticeBox>
            )}
            <BatchWorkspace
                programMetadata={programMetadata}
                variables={variables}
                config={config}
                applyBatch={applyBatch}
                isApplyingBatch={isApplyingBatch}
                batchProgress={batchProgress}
            />
            <VariableList
                programMetadata={programMetadata}
                variables={variables}
            />
        </div>
    )
}
