import i18n from '@dhis2/d2-i18n'
import { Card, IconChevronDown24, IconChevronRight24, Tag } from '@dhis2/ui'
import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import styles from './VariableList.module.css'
import { prGetExisting } from '@/lib/detector'
import type { ProgramMetadata, Variable } from '@/lib/types'
import { VALUE_TYPE_LABELS, variablePath } from '@/lib/variables'

const TYPE_LABELS: Record<string, string> = {
    enrollment: 'Enrollment date',
    incident: 'Incident date',
    trackedEntityAttribute: 'Tracked entity attribute',
    event_date: 'Event date',
    due_date: 'Due date',
    dataElement: 'Data element',
}

const VariableRow = ({
    variable,
    ruleCount,
}: {
    variable: Variable
    ruleCount: number
}) => {
    const navigate = useNavigate()
    const { programId } = useParams()
    const openDetails = () =>
        navigate(variablePath(programId as string, variable))

    return (
        <button
            type="button"
            className={styles.variableRow}
            onClick={openDetails}
        >
            <span className={styles.variableName}>{variable.name}</span>
            <span className={styles.variableType}>
                ({TYPE_LABELS[variable.type] || variable.type})
            </span>
            <span className={styles.rowSpacer} />
            {variable.futureDatesAllowed && (
                <Tag>{i18n.t('Future dates allowed')}</Tag>
            )}
            {ruleCount > 0 && (
                <Tag positive>
                    {ruleCount === 1
                        ? i18n.t('1 rule')
                        : i18n.t('{{count}} rules', { count: ruleCount })}
                </Tag>
            )}
            <Tag neutral={variable.category !== 'numeric'}>
                {variable.category === 'numeric'
                    ? VALUE_TYPE_LABELS[variable.valueType ?? ''] ||
                      i18n.t('Numeric')
                    : i18n.t('Date')}
            </Tag>
        </button>
    )
}

export const VariableList = ({
    programMetadata,
    variables,
}: {
    programMetadata: ProgramMetadata
    variables: Variable[]
}) => {
    const ruleCounts = useMemo(() => {
        const counts = new Map<Variable, number>()
        variables.forEach((variable) => {
            counts.set(
                variable,
                prGetExisting(programMetadata, variable).length
            )
        })
        return counts
    }, [programMetadata, variables])

    const enrollmentVariables = variables.filter((v) =>
        ['enrollment', 'incident', 'trackedEntityAttribute'].includes(v.type)
    )
    const stages = programMetadata.programStages || []

    return (
        <div className={styles.lists}>
            <Card>
                <div className={styles.cardHeader}>
                    <h3>{i18n.t('Enrollment & programme dates')}</h3>
                </div>
                <div className={styles.cardBody}>
                    {enrollmentVariables.length === 0 && (
                        <p className={styles.emptyState}>
                            {i18n.t(
                                'No date or numeric variables at enrollment level.'
                            )}
                        </p>
                    )}
                    {enrollmentVariables.map((variable) => (
                        <VariableRow
                            key={`${variable.type}:${variable.id}`}
                            variable={variable}
                            ruleCount={ruleCounts.get(variable) ?? 0}
                        />
                    ))}
                </div>
            </Card>
            {stages.map((stage) => {
                const stageVariables = variables.filter(
                    (v) => v.stageId === stage.id
                )
                if (stageVariables.length === 0) {
                    return null
                }
                return (
                    <StageCard
                        key={stage.id}
                        name={stage.name}
                        stageVariables={stageVariables}
                        ruleCounts={ruleCounts}
                    />
                )
            })}
        </div>
    )
}

const StageCard = ({
    name,
    stageVariables,
    ruleCounts,
}: {
    name: string
    stageVariables: Variable[]
    ruleCounts: Map<Variable, number>
}) => {
    const [open, setOpen] = useState(false)
    return (
        <Card>
            <button
                type="button"
                className={styles.stageToggle}
                onClick={() => setOpen((prev) => !prev)}
            >
                {open ? <IconChevronDown24 /> : <IconChevronRight24 />}
                <h3>{name}</h3>
                <span className={styles.rowSpacer} />
                <Tag>{String(stageVariables.length)}</Tag>
            </button>
            {open && (
                <div className={styles.cardBody}>
                    {stageVariables.map((variable) => (
                        <VariableRow
                            key={`${variable.type}:${variable.id}`}
                            variable={variable}
                            ruleCount={ruleCounts.get(variable) ?? 0}
                        />
                    ))}
                </div>
            )}
        </Card>
    )
}
