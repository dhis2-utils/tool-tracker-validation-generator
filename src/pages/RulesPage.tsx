import i18n from '@dhis2/d2-i18n'
import {
    Button,
    Card,
    CircularLoader,
    IconArrowLeft24,
    IconChevronDown24,
    IconChevronRight24,
    NoticeBox,
    Tag,
} from '@dhis2/ui'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import styles from './RulesPage.module.css'
import { ConfirmModal } from '@/components/ConfirmModal'
import { RuleCard } from '@/components/RuleCard'
import { ValidationForm } from '@/components/ValidationForm'
import { useProgramData } from '@/hooks/useProgramData'
import { useValidationActions } from '@/hooks/useValidationActions'
import { FEEDBACK_ACTION_TYPES, prGetExisting } from '@/lib/detector'
import { parseRuleCondition } from '@/lib/parser'
import { isAppGenerated, isBatchGenerated } from '@/lib/signature'
import type {
    ExistingValidation,
    ValidationConfig,
    Variable,
} from '@/lib/types'
import { buildEditConfig, getValidationPreview } from '@/lib/validation'

interface RuleRow {
    validation: ExistingValidation
    variable: Variable
    summary: string
    actionType: string
}

interface RuleGroup {
    key: string
    summary: string
    rows: RuleRow[]
}

export const RulesPage = () => {
    const { programId } = useParams()
    const navigate = useNavigate()
    const { programMetadata, config, variables, isLoading, error } =
        useProgramData(programId)
    const {
        deleteValidations,
        isDeleting,
        updateValidationRules,
        isUpdatingMany: isUpdating,
    } = useValidationActions({
        programId: programId as string,
        programMetadata,
        config,
        variables,
    })
    const [deleteRows, setDeleteRows] = useState<RuleRow[] | null>(null)
    // Groups are collapsed by default; this holds the keys that are expanded.
    const [expanded, setExpanded] = useState<Set<string>>(new Set())
    const [editGroupKey, setEditGroupKey] = useState<string | null>(null)

    const { batchGroups, individualRules } = useMemo(() => {
        if (!programMetadata) {
            return { batchGroups: [], individualRules: [] as RuleRow[] }
        }
        // Attribute each app-managed rule to a validated variable (reusing the
        // detector so "between" and stage scoping match the rest of the app).
        const byRule = new Map<string, RuleRow>()
        for (const variable of variables) {
            for (const validation of prGetExisting(programMetadata, variable)) {
                if (
                    isAppGenerated(validation.rule) &&
                    !byRule.has(validation.rule.id)
                ) {
                    const action = validation.actions.find((a) =>
                        FEEDBACK_ACTION_TYPES.includes(a.programRuleActionType)
                    )
                    const parsed = parseRuleCondition(
                        validation.rule.condition,
                        programMetadata,
                        validation.rule.programStage?.id
                    )
                    let summary = validation.rule.condition
                    if (parsed && action) {
                        const cfg = buildEditConfig(
                            parsed,
                            validation.rule,
                            action,
                            variable,
                            variables,
                            config?.programRulePrefix
                        )
                        const preview = getValidationPreview(
                            variable,
                            cfg,
                            variables
                        ).preview
                        // Drop the leading variable name so the remainder ("…
                        // should be after 1900-01-01") groups rules that share
                        // one template across many variables.
                        summary = preview.startsWith(variable.name)
                            ? preview.slice(variable.name.length).trim()
                            : preview
                    }
                    byRule.set(validation.rule.id, {
                        validation,
                        variable,
                        summary,
                        actionType: action?.programRuleActionType ?? 'UNKNOWN',
                    })
                }
            }
        }

        const groups = new Map<string, RuleGroup>()
        const individual: RuleRow[] = []
        for (const row of byRule.values()) {
            if (!isBatchGenerated(row.validation.rule)) {
                individual.push(row)
                continue
            }
            const key = `${row.variable.category ?? ''}|${row.summary}|${row.actionType}`
            if (!groups.has(key)) {
                groups.set(key, { key, summary: row.summary, rows: [] })
            }
            groups.get(key)!.rows.push(row)
        }
        return {
            batchGroups: [...groups.values()],
            individualRules: individual,
        }
    }, [programMetadata, variables, config])

    if (isLoading) {
        return (
            <div className={styles.loadingContainer}>
                <CircularLoader />
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

    const routeFor = (variable: Variable) =>
        `/${programId}/variable/${variable.type}/${variable.id}${
            variable.stageId ? `/${variable.stageId}` : ''
        }`

    const deleteAll = async () => {
        try {
            await deleteValidations(
                (deleteRows ?? []).map((row) => row.validation)
            )
        } catch {
            // summary alert already shown by useValidationActions
        } finally {
            setDeleteRows(null)
        }
    }

    const toggleGroup = (key: string) =>
        setExpanded((prev) => {
            const next = new Set(prev)
            if (next.has(key)) {
                next.delete(key)
            } else {
                next.add(key)
            }
            return next
        })

    const openGroupEdit = (key: string) => {
        setEditGroupKey(key)
        setExpanded((prev) => new Set(prev).add(key))
    }

    // Seed the group-edit form from one rule's template, with the per-rule
    // name/description/message cleared so each rule regenerates its own.
    const seedConfigFor = (row: RuleRow): ValidationConfig | undefined => {
        const action = row.validation.actions.find((a) =>
            FEEDBACK_ACTION_TYPES.includes(a.programRuleActionType)
        )
        const parsed = parseRuleCondition(
            row.validation.rule.condition,
            programMetadata,
            row.validation.rule.programStage?.id
        )
        if (!parsed || !action) {
            return undefined
        }
        const cfg = buildEditConfig(
            parsed,
            row.validation.rule,
            action,
            row.variable,
            variables,
            config?.programRulePrefix
        )
        return {
            ...cfg,
            ruleName: undefined,
            ruleDescription: undefined,
            ruleMessage: undefined,
        }
    }

    // Apply an edited template to every rule in the group, regenerating each
    // rule's name/description/message from its own variable to avoid clashes.
    const handleGroupEditSubmit = async (
        rows: RuleRow[],
        templateConfig: ValidationConfig
    ) => {
        // Leave name/description unset so updateValidation regenerates a
        // stage-aware, unique name per variable and preserves the batch tag
        // (one shared name would collide across same-named variables in
        // different stages). Only the message is supplied.
        const items = rows.map((row) => ({
            ruleId: row.validation.rule.id,
            name: row.validation.rule.name,
            variable: row.variable,
            config: {
                ...templateConfig,
                ruleName: undefined,
                ruleDescription: undefined,
                ruleMessage: getValidationPreview(
                    row.variable,
                    templateConfig,
                    variables
                ).suggestedMessage,
            },
        }))
        try {
            const { failures } = await updateValidationRules({ items })
            // keep the panel open when some rules failed, so the summary
            // alert can be acted on
            if (failures.length === 0) {
                setEditGroupKey(null)
            }
        } catch {
            // summary alert already shown by useValidationActions
        }
    }

    const busy = isDeleting || isUpdating

    const totalRules =
        batchGroups.reduce((n, g) => n + g.rows.length, 0) +
        individualRules.length

    const renderRow = (row: RuleRow) => (
        <RuleCard
            key={row.validation.rule.id}
            validation={row.validation}
            isEditable
            busy={busy}
            onEdit={() => navigate(routeFor(row.variable))}
            onDelete={() => setDeleteRows([row])}
        />
    )

    return (
        <div className={styles.page}>
            <div>
                <Link to={`/${programId}`} className={styles.backLink}>
                    <Button small secondary icon={<IconArrowLeft24 />}>
                        {i18n.t('Back to overview')}
                    </Button>
                </Link>
            </div>
            <h2 className={styles.heading}>
                {i18n.t('All validation rules created by this tool')}
            </h2>

            {totalRules === 0 && (
                <NoticeBox title={i18n.t('No rules yet')}>
                    {i18n.t(
                        'This tool has not created any validation rules in this programme yet.'
                    )}
                </NoticeBox>
            )}

            {batchGroups.length > 0 && (
                <Card>
                    <div className={styles.cardHeader}>
                        <h3>{i18n.t('Bulk rules')}</h3>
                        <p className={styles.subtle}>
                            {i18n.t(
                                'Rules created from a bulk template, grouped by template. Each can still be edited or removed per variable.'
                            )}
                        </p>
                    </div>
                    <div className={styles.cardBody}>
                        {batchGroups.map((group) => {
                            const isCollapsed = !expanded.has(group.key)
                            const isEditing = editGroupKey === group.key
                            return (
                                <div key={group.key} className={styles.group}>
                                    <div className={styles.groupHeader}>
                                        <button
                                            type="button"
                                            className={styles.collapseToggle}
                                            aria-expanded={!isCollapsed}
                                            onClick={() =>
                                                toggleGroup(group.key)
                                            }
                                        >
                                            {isCollapsed ? (
                                                <IconChevronRight24 />
                                            ) : (
                                                <IconChevronDown24 />
                                            )}
                                        </button>
                                        <span className={styles.groupTitle}>
                                            {group.summary || i18n.t('(rule)')}
                                        </span>
                                        <Tag>
                                            {i18n.t('{{count}} variables', {
                                                count: group.rows.length,
                                            })}
                                        </Tag>
                                        <span className={styles.spacer} />
                                        <Button
                                            small
                                            secondary
                                            disabled={busy || isEditing}
                                            onClick={() =>
                                                openGroupEdit(group.key)
                                            }
                                        >
                                            {i18n.t('Edit all in group')}
                                        </Button>
                                        <Button
                                            small
                                            destructive
                                            disabled={busy}
                                            onClick={() =>
                                                setDeleteRows(group.rows)
                                            }
                                        >
                                            {i18n.t('Delete all in group')}
                                        </Button>
                                    </div>
                                    {!isCollapsed &&
                                        (isEditing ? (
                                            <div className={styles.groupEdit}>
                                                <NoticeBox
                                                    title={i18n.t(
                                                        'Editing {{count}} rules together',
                                                        {
                                                            count: group.rows
                                                                .length,
                                                        }
                                                    )}
                                                >
                                                    {i18n.t(
                                                        'Changes below apply to every rule in this group. Each rule keeps its own variable; names and messages are regenerated per variable.'
                                                    )}
                                                </NoticeBox>
                                                <ValidationForm
                                                    variable={
                                                        group.rows[0].variable
                                                    }
                                                    variables={variables}
                                                    programConfig={config}
                                                    initialConfig={seedConfigFor(
                                                        group.rows[0]
                                                    )}
                                                    editing
                                                    busy={isUpdating}
                                                    hideRuleFields
                                                    submitLabel={i18n.t(
                                                        'Update all {{count}} rules',
                                                        {
                                                            count: group.rows
                                                                .length,
                                                        }
                                                    )}
                                                    onSubmit={(cfg) =>
                                                        handleGroupEditSubmit(
                                                            group.rows,
                                                            cfg
                                                        )
                                                    }
                                                    onCancelEdit={() =>
                                                        setEditGroupKey(null)
                                                    }
                                                />
                                            </div>
                                        ) : (
                                            group.rows.map(renderRow)
                                        ))}
                                </div>
                            )
                        })}
                    </div>
                </Card>
            )}

            {individualRules.length > 0 && (
                <Card>
                    <div className={styles.cardHeader}>
                        <h3>{i18n.t('Individual rules')}</h3>
                    </div>
                    <div className={styles.cardBody}>
                        {individualRules.map(renderRow)}
                    </div>
                </Card>
            )}

            {deleteRows && deleteRows.length > 0 && (
                <ConfirmModal
                    title={i18n.t('Delete validation rule(s)')}
                    confirmLabel={i18n.t('Delete')}
                    destructive
                    busy={isDeleting}
                    onCancel={() => setDeleteRows(null)}
                    onConfirm={deleteAll}
                >
                    {deleteRows.length === 1 ? (
                        i18n.t('Are you sure you want to delete "{{name}}"?', {
                            name: deleteRows[0].validation.rule.name,
                            nsSeparator: undefined,
                        })
                    ) : (
                        <>
                            <p>
                                {i18n.t(
                                    'Delete these {{count}} rules created from the same template?',
                                    { count: deleteRows.length }
                                )}
                            </p>
                            <ul>
                                {deleteRows.map((row) => (
                                    <li key={row.validation.rule.id}>
                                        {row.validation.rule.name}
                                    </li>
                                ))}
                            </ul>
                        </>
                    )}
                </ConfirmModal>
            )}
        </div>
    )
}
