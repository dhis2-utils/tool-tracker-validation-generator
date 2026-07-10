import { useAlert } from '@dhis2/app-runtime'
import i18n from '@dhis2/d2-i18n'
import {
    Button,
    IconSettings24,
    SingleSelect,
    SingleSelectOption,
} from '@dhis2/ui'
import { useEffect, useState } from 'react'
import { Outlet, useNavigate, useParams } from 'react-router-dom'
import styles from './AppShell.module.css'
import { BatchQueueProvider } from '@/components/BatchQueueContext'
import { SettingsModal } from '@/components/SettingsModal'
import { usePrograms } from '@/hooks/usePrograms'

export const AppShell = () => {
    const { programId } = useParams()
    const navigate = useNavigate()
    const { programs, isLoading, error } = usePrograms()
    const [settingsOpen, setSettingsOpen] = useState(false)
    const { show: showLoadError } = useAlert(
        ({ message }: { message: string }) =>
            i18n.t('Error loading programmes: {{message}}', {
                message,
                nsSeparator: undefined,
            }),
        { critical: true }
    )

    useEffect(() => {
        if (error) {
            showLoadError({ message: error.message })
        }
    }, [error]) // showLoadError identity is stable across renders

    return (
        <div className={styles.shell}>
            <header className={styles.header}>
                <div className={styles.brand}>
                    <span className={styles.brandIcon}>✓</span>
                    <span className={styles.brandName}>
                        {i18n.t('Tracker Validation Tool')}
                    </span>
                </div>
                <div className={styles.programSelect}>
                    <SingleSelect
                        dense
                        filterable
                        loading={isLoading}
                        placeholder={i18n.t('Select a tracker programme...')}
                        noMatchText={i18n.t('No programmes match the filter')}
                        selected={
                            programId &&
                            programs?.some((p) => p.id === programId)
                                ? programId
                                : undefined
                        }
                        onChange={({ selected }: { selected: string }) =>
                            navigate(`/${selected}`)
                        }
                    >
                        {(programs || []).map((program) => (
                            <SingleSelectOption
                                key={program.id}
                                value={program.id}
                                label={program.displayName}
                            />
                        ))}
                    </SingleSelect>
                </div>
                <div className={styles.spacer} />
                <Button
                    small
                    secondary
                    icon={<IconSettings24 />}
                    disabled={!programId}
                    onClick={() => setSettingsOpen(true)}
                >
                    {i18n.t('Programme settings')}
                </Button>
            </header>
            <main className={styles.main}>
                <BatchQueueProvider programId={programId}>
                    <Outlet />
                </BatchQueueProvider>
            </main>
            {settingsOpen && programId && (
                <SettingsModal
                    programId={programId}
                    onClose={() => setSettingsOpen(false)}
                />
            )}
        </div>
    )
}
