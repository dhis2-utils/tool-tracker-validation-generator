import i18n from '@dhis2/d2-i18n'
import {
    Button,
    Card,
    CircularLoader,
    IconArrowLeft24,
    NoticeBox,
} from '@dhis2/ui'
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import styles from './DetailsPage.module.css'
import { ConfirmModal } from '@/components/ConfirmModal'
import {
    editBlockedReason,
    RuleCard,
    type RuleOrigin,
} from '@/components/RuleCard'
import { ValidationForm } from '@/components/ValidationForm'
import { useFeedback } from '@/hooks/useFeedback'
import { useProgramData } from '@/hooks/useProgramData'
import { useValidationActions } from '@/hooks/useValidationActions'
import {
    prGetExisting,
    prGetReferencing,
    validatedVariable,
} from '@/lib/detector'
import { parseRuleCondition } from '@/lib/parser'
import { isAppGenerated, isBatchGenerated } from '@/lib/signature'
import type { ExistingValidation, ValidationConfig } from '@/lib/types'
import { buildEditConfig } from '@/lib/validation'
import { findVariableByComponents, variablePath } from '@/lib/variables'

interface EditingState {
    ruleId: string
    config: ValidationConfig
}

export const DetailsPage = () => {
    const { programId, type, id, stageId } = useParams()
    const { programMetadata, config, variables, isLoading, error } =
        useProgramData(programId)
    const { showError } = useFeedback()
    const [editing, setEditing] = useState<EditingState | null>(null)
    const [formResetKey, setFormResetKey] = useState(0)
    const [deleteCandidate, setDeleteCandidate] =
        useState<ExistingValidation | null>(null)
    const [cleanupCandidates, setCleanupCandidates] = useState<
        ExistingValidation[] | null
    >(null)

    const variable = useMemo(
        () =>
            findVariableByComponents(variables, id ?? '', type ?? '', stageId),
        [variables, id, type, stageId]
    )

    // The same route element serves every variable, so param-only navigation
    // (e.g. browser back) keeps this component mounted — clear any in-flight
    // edit/confirm state so it can't be applied to a different variable.
    useEffect(() => {
        setEditing(null)
        setDeleteCandidate(null)
        setCleanupCandidates(null)
    }, [type, id, stageId])

    const {
        createValidation,
        isCreating,
        updateValidationRule,
        isUpdating,
        deleteValidation,
        deleteValidations,
        isDeleting,
    } = useValidationActions({
        programId: programId as string,
        programMetadata,
        config,
        variables,
    })

    const validations = useMemo(
        () => prGetExisting(programMetadata, variable),
        [programMetadata, variable]
    )
    const referencing = useMemo(
        () => prGetReferencing(programMetadata, variable),
        [programMetadata, variable]
    )

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

    if (!programMetadata || !variable) {
        return (
            <NoticeBox warning title={i18n.t('Variable not found')}>
                <p>
                    {i18n.t(
                        'The requested variable does not exist in this programme.'
                    )}
                </p>
                <Link to={`/${programId}`}>{i18n.t('Back to overview')}</Link>
            </NoticeBox>
        )
    }

    const appValidations = validations.filter((v) => isAppGenerated(v.rule))
    // Rules this tool didn't create: same-shape validations from elsewhere,
    // plus any other rule that reads the field. Shown read-only.
    const otherValidations = [
        ...validations.filter((v) => !isAppGenerated(v.rule)),
        ...referencing,
    ]

    // Tells the tool's own rules for another field apart from rules set up elsewhere.
    const originOf = (validation: ExistingValidation): RuleOrigin => {
        if (!isAppGenerated(validation.rule)) {
            return { managed: false }
        }
        const owner = validatedVariable(
            programMetadata,
            validation.rule,
            variables ?? []
        )
        return {
            managed: true,
            validates: owner && {
                variable: owner,
                path: variablePath(programId as string, owner),
            },
        }
    }

    const startEditing = (validation: ExistingValidation) => {
        const blocked = editBlockedReason(validation)
        if (blocked) {
            showError(blocked)
            return
        }
        const [action] = validation.actions
        if (!action) {
            showError(i18n.t('No editable action found for this rule'))
            return
        }
        const parsed = parseRuleCondition(
            validation.rule.condition,
            programMetadata,
            validation.rule.programStage?.id
        )
        if (!parsed) {
            showError(i18n.t('Cannot parse rule condition for editing'))
            return
        }
        setEditing({
            ruleId: validation.rule.id,
            config: buildEditConfig(
                parsed,
                validation.rule,
                action,
                variable,
                variables,
                config?.programRulePrefix
            ),
        })
    }

    // Mutation failures are reported through the hook's error alerts; the
    // try/catch here only prevents unhandled promise rejections and keeps
    // the form state for the user to correct.
    const handleSubmit = async (validationConfig: ValidationConfig) => {
        try {
            if (editing) {
                await updateValidationRule({
                    ruleId: editing.ruleId,
                    config: validationConfig,
                    variable,
                })
                setEditing(null)
                setFormResetKey((k) => k + 1)
                return
            }
            // Capture existing batch rules before creating: once the specific
            // rule exists we offer to remove the generic batch-generated ones.
            const batchRules = prGetExisting(programMetadata, variable).filter(
                (v) => isBatchGenerated(v.rule)
            )
            await createValidation({ config: validationConfig, variable })
            setFormResetKey((k) => k + 1)
            if (batchRules.length > 0) {
                setCleanupCandidates(batchRules)
            }
        } catch {
            // error alert already shown by useValidationActions
        }
    }

    const handleCleanupConfirm = async () => {
        try {
            await deleteValidations(cleanupCandidates ?? [])
        } catch {
            // summary alert already shown by useValidationActions
        } finally {
            setCleanupCandidates(null)
        }
    }

    const busy = isCreating || isUpdating || isDeleting

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
                {i18n.t('{{name}} — validation settings', {
                    name: variable.name,
                    nsSeparator: undefined,
                })}
            </h2>

            <Card>
                <div className={styles.cardHeader}>
                    <h3>{i18n.t('Current validations')}</h3>
                </div>
                <div className={styles.cardBody}>
                    {appValidations.length === 0 ? (
                        <p className={styles.emptyState}>
                            {i18n.t(
                                'No validations configured for this variable.'
                            )}
                        </p>
                    ) : (
                        appValidations.map((validation) => (
                            <RuleCard
                                key={validation.rule.id}
                                validation={validation}
                                isEditable
                                busy={busy}
                                onEdit={() => startEditing(validation)}
                                onDelete={() => setDeleteCandidate(validation)}
                            />
                        ))
                    )}
                </div>
            </Card>

            {otherValidations.length > 0 && (
                <Card>
                    <div className={styles.cardHeader}>
                        <h3>
                            {i18n.t('Other program rules using this variable')}
                        </h3>
                    </div>
                    <div className={styles.cardBody}>
                        {otherValidations.map((validation) => (
                            <RuleCard
                                key={validation.rule.id}
                                validation={validation}
                                origin={originOf(validation)}
                                isEditable={false}
                                busy={busy}
                                onDelete={() => setDeleteCandidate(validation)}
                            />
                        ))}
                    </div>
                </Card>
            )}

            <Card>
                <div className={styles.cardHeader}>
                    <h3>
                        {editing
                            ? i18n.t('Edit program rule')
                            : i18n.t('Add new validation')}
                    </h3>
                </div>
                <div className={styles.cardBody}>
                    <ValidationForm
                        key={`${variable.type}:${variable.id}:${
                            variable.stageId ?? ''
                        }:${editing?.ruleId ?? 'new'}:${formResetKey}`}
                        variable={variable}
                        variables={variables}
                        programConfig={config}
                        initialConfig={editing?.config}
                        editing={Boolean(editing)}
                        busy={isCreating || isUpdating}
                        onSubmit={handleSubmit}
                        onCancelEdit={() => setEditing(null)}
                    />
                </div>
            </Card>

            {deleteCandidate && (
                <ConfirmModal
                    title={i18n.t('Delete validation rule')}
                    confirmLabel={i18n.t('Delete')}
                    destructive
                    busy={isDeleting}
                    onCancel={() => setDeleteCandidate(null)}
                    onConfirm={async () => {
                        try {
                            await deleteValidation(deleteCandidate)
                        } catch {
                            // error alert already shown by useValidationActions
                        }
                        setDeleteCandidate(null)
                    }}
                >
                    <p>
                        {i18n.t('Are you sure you want to delete "{{name}}"?', {
                            name: deleteCandidate.rule.name,
                            nsSeparator: undefined,
                        })}
                    </p>
                    {!isAppGenerated(deleteCandidate.rule) && (
                        <NoticeBox
                            warning
                            title={i18n.t('Not created by this tool')}
                        >
                            {i18n.t(
                                'This rule was created outside this tool. Deleting it removes the whole rule, including all {{count}} of its actions: {{types}}.',
                                {
                                    count: deleteCandidate.allActions.length,
                                    types: deleteCandidate.allActions
                                        .map((a) => a.programRuleActionType)
                                        .join(', '),
                                    nsSeparator: undefined,
                                }
                            )}
                        </NoticeBox>
                    )}
                </ConfirmModal>
            )}

            {cleanupCandidates && cleanupCandidates.length > 0 && (
                <ConfirmModal
                    title={i18n.t('Remove batch rules?')}
                    confirmLabel={i18n.t('Remove batch rules')}
                    destructive
                    busy={isDeleting}
                    onCancel={() => setCleanupCandidates(null)}
                    onConfirm={handleCleanupConfirm}
                >
                    <p>
                        {cleanupCandidates.length === 1
                            ? i18n.t(
                                  'This variable already has a batch rule. Remove it since you now have a specific rule?'
                              )
                            : i18n.t(
                                  'This variable has {{count}} batch rules. Remove them since you now have a specific rule?',
                                  { count: cleanupCandidates.length }
                              )}
                    </p>
                    <ul>
                        {cleanupCandidates.map((validation) => (
                            <li key={validation.rule.id}>
                                {validation.rule.name}
                            </li>
                        ))}
                    </ul>
                </ConfirmModal>
            )}
        </div>
    )
}
