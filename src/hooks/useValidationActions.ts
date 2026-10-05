import { useAlert, useConfig, useDataEngine } from '@dhis2/app-runtime'
import i18n from '@dhis2/d2-i18n'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { programMetadataQueryKey } from './useProgramMetadata'
import type {
    BatchTemplate,
    ExistingValidation,
    ProgramMetadata,
    ValidationConfig,
    Variable,
} from '@/lib/types'
import {
    applyBatchTemplates,
    BatchApplyResult,
    BatchProgress,
    ConditionCheck,
    createValidationForVariable,
    deleteRule,
    ProgramConfig,
    RuleServiceContext,
    SaveResult,
    updateValidation,
} from '@/services/rules'

interface UseValidationActionsInput {
    programId: string
    programMetadata: ProgramMetadata | null
    config: ProgramConfig | null
    variables: Variable[]
}

/**
 * All rule mutations, wrapped with metadata cloning (the services extend
 * their working copy with created objects), cache invalidation and alerts.
 */
export const useValidationActions = ({
    programId,
    programMetadata,
    config,
    variables,
}: UseValidationActionsInput) => {
    const engine = useDataEngine()
    const { baseUrl } = useConfig()
    const queryClient = useQueryClient()
    // One useAlert instance per outcome: app-runtime's useAlert manages a
    // single alert per instance and silently ignores show() while that alert
    // is still visible — a shared instance would swallow e.g. the "deleted"
    // confirmation that immediately follows a "created" one.
    const { show: showCreated } = useAlert(
        i18n.t('Validation rule created successfully'),
        { success: true }
    )
    const { show: showUpdated } = useAlert(
        i18n.t('Validation rule updated successfully'),
        { success: true }
    )
    const { show: showDeleted } = useAlert(
        i18n.t('Validation rule deleted successfully'),
        { success: true }
    )
    const { show: showBatchDone } = useAlert(
        ({ message }: { message: string }) => message,
        { success: true }
    )
    const { show: showCreateError } = useAlert(
        ({ message }: { message: string }) =>
            i18n.t('Error creating validation rule: {{message}}', {
                message,
                nsSeparator: undefined,
            }),
        { critical: true }
    )
    const { show: showUpdateError } = useAlert(
        ({ message }: { message: string }) =>
            i18n.t('Error updating validation rule: {{message}}', {
                message,
                nsSeparator: undefined,
            }),
        { critical: true }
    )
    const { show: showDeleteError } = useAlert(
        ({ message }: { message: string }) =>
            i18n.t('Error deleting validation rule: {{message}}', {
                message,
                nsSeparator: undefined,
            }),
        { critical: true }
    )
    const { show: showBatchError } = useAlert(
        ({ message }: { message: string }) => message,
        { critical: true }
    )
    const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(
        null
    )

    const { show: showUnchecked } = useAlert(
        ({ message }: { message: string }) => message,
        { warning: true }
    )
    const { show: showSummary } = useAlert(
        ({ message }: { message: string; failed: boolean }) => message,
        ({ failed }: { message: string; failed: boolean }) =>
            failed ? { critical: true } : { success: true }
    )

    // Validate a condition against DHIS2 before a rule is saved. The endpoint
    // consumes a text/plain body, which the app-runtime data engine can't send,
    // so this uses a direct fetch against the configured baseUrl (with session
    // credentials). It answers HTTP 200 with status ERROR for an invalid
    // expression; any other failure (401, proxy error, offline, non-JSON) means
    // the check could not run: the rule is still saved, with a warning.
    const validateCondition = async (
        condition: string
    ): Promise<ConditionCheck> => {
        try {
            const res = await fetch(
                `${baseUrl}/api/programRules/condition/description?programId=${programId}`,
                {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'text/plain' },
                    body: condition,
                }
            )
            if (!res.ok) {
                return { status: 'unchecked' }
            }
            const body = await res.json()
            if (body.status === 'ERROR') {
                const message = [body.message, body.description]
                    .filter(Boolean)
                    .join(': ')
                return { status: 'invalid', message }
            }
            return body.status === 'OK'
                ? { status: 'valid' }
                : { status: 'unchecked' }
        } catch {
            return { status: 'unchecked' }
        }
    }

    const warnIfUnchecked = (results: SaveResult[]) => {
        const unchecked = results.filter((r) => !r.conditionChecked).length
        if (unchecked > 0) {
            showUnchecked({
                message: i18n.t(
                    'DHIS2 could not be asked to validate the condition of {{count}} saved rule(s). Check them in the Maintenance app.',
                    { count: unchecked }
                ),
            })
        }
    }

    const buildCtx = (): RuleServiceContext => {
        if (!programMetadata) {
            throw new Error(i18n.t('Programme metadata is not loaded yet'))
        }
        return {
            engine,
            metadata: structuredClone(programMetadata),
            programId,
            config,
            variables,
            validateCondition,
        }
    }

    const invalidateMetadata = () =>
        queryClient.invalidateQueries({
            queryKey: programMetadataQueryKey(programId),
        })

    const createMutation = useMutation<
        SaveResult,
        Error,
        { config: ValidationConfig; variable: Variable }
    >(
        ({ config: validationConfig, variable }) =>
            createValidationForVariable(buildCtx(), validationConfig, variable),
        {
            onSuccess: (result) => {
                showCreated()
                warnIfUnchecked([result])
                invalidateMetadata()
            },
            onError: (error) => {
                showCreateError({ message: error.message })
            },
        }
    )

    const updateMutation = useMutation<
        SaveResult,
        Error,
        { ruleId: string; config: ValidationConfig; variable: Variable }
    >(
        ({ ruleId, config: validationConfig, variable }) =>
            updateValidation(buildCtx(), {
                ruleId,
                config: validationConfig,
                currentVariable: variable,
            }),
        {
            onSuccess: (result) => {
                showUpdated()
                warnIfUnchecked([result])
                invalidateMetadata()
            },
            onError: (error) => {
                showUpdateError({ message: error.message })
            },
        }
    )

    const deleteMutation = useMutation<void, Error, ExistingValidation>(
        (validation) => deleteRule(engine, validation),
        {
            onSuccess: () => {
                showDeleted()
                invalidateMetadata()
            },
            onError: (error) => {
                showDeleteError({ message: error.message })
            },
        }
    )

    // Several rules in one go (group edit, delete all, batch cleanup): every
    // rule is attempted, then ONE alert sums up what happened and names the
    // rules that failed, instead of per-rule alerts that hide each other.
    const describeFailures = (failures: { name: string; message: string }[]) =>
        failures.map((f) => `"${f.name}" (${f.message})`).join('; ')

    const updateManyMutation = useMutation<
        { failures: { name: string; message: string }[] },
        Error,
        {
            items: {
                ruleId: string
                name: string
                config: ValidationConfig
                variable: Variable
            }[]
        }
    >(
        async ({ items }) => {
            const ctx = buildCtx()
            const results: SaveResult[] = []
            const failures: { name: string; message: string }[] = []
            for (const item of items) {
                try {
                    results.push(
                        await updateValidation(ctx, {
                            ruleId: item.ruleId,
                            config: item.config,
                            currentVariable: item.variable,
                        })
                    )
                } catch (error) {
                    failures.push({
                        name: item.name,
                        message: (error as Error).message,
                    })
                }
            }
            showSummary({
                failed: failures.length > 0,
                message:
                    failures.length > 0
                        ? i18n.t(
                              'Updated {{count}} rule(s). Could not update {{failedCount}}: {{details}}',
                              {
                                  count: results.length,
                                  failedCount: failures.length,
                                  details: describeFailures(failures),
                                  nsSeparator: undefined,
                              }
                          )
                        : i18n.t('Updated {{count}} rule(s).', {
                              count: results.length,
                          }),
            })
            warnIfUnchecked(results)
            return { failures }
        },
        { onSettled: () => invalidateMetadata() }
    )

    const deleteManyMutation = useMutation<
        { failures: { name: string; message: string }[] },
        Error,
        ExistingValidation[]
    >(
        async (validations) => {
            let deleted = 0
            const failures: { name: string; message: string }[] = []
            for (const validation of validations) {
                try {
                    await deleteRule(engine, validation)
                    deleted++
                } catch (error) {
                    failures.push({
                        name: validation.rule.name,
                        message: (error as Error).message,
                    })
                }
            }
            showSummary({
                failed: failures.length > 0,
                message:
                    failures.length > 0
                        ? i18n.t(
                              'Deleted {{count}} rule(s). Could not delete {{failedCount}}: {{details}}',
                              {
                                  count: deleted,
                                  failedCount: failures.length,
                                  details: describeFailures(failures),
                                  nsSeparator: undefined,
                              }
                          )
                        : i18n.t('Deleted {{count}} rule(s).', {
                              count: deleted,
                          }),
            })
            return { failures }
        },
        { onSettled: () => invalidateMetadata() }
    )

    const batchMutation = useMutation<
        BatchApplyResult,
        Error,
        {
            templates: BatchTemplate[]
            getTargets: (template: BatchTemplate) => Variable[]
        }
    >(
        ({ templates, getTargets }) =>
            applyBatchTemplates(
                buildCtx(),
                templates,
                getTargets,
                setBatchProgress
            ),
        {
            onSettled: () => {
                setBatchProgress(null)
                invalidateMetadata()
            },
            onSuccess: (result) => {
                if (result.uncheckedCount > 0) {
                    showUnchecked({
                        message: i18n.t(
                            'DHIS2 could not be asked to validate the condition of {{count}} saved rule(s). Check them in the Maintenance app.',
                            { count: result.uncheckedCount }
                        ),
                    })
                }
                if (result.errors.length > 0) {
                    showBatchError({
                        message: i18n.t(
                            'Created {{count}} rule(s). {{skipped}} skipped: {{errors}}',
                            {
                                count: result.createdCount,
                                skipped: result.errors.length,
                                errors: result.errors.join('; '),
                                nsSeparator: undefined,
                            }
                        ),
                    })
                } else if (result.createdCount === 1) {
                    showBatchDone({
                        message: i18n.t(
                            'Created 1 validation rule from the queued bulk rules'
                        ),
                    })
                } else {
                    showBatchDone({
                        message: i18n.t(
                            'Created {{count}} validation rules from the queued bulk rules',
                            { count: result.createdCount }
                        ),
                    })
                }
            },
            onError: (error) => {
                showBatchError({
                    message: i18n.t('Error applying bulk rules: {{message}}', {
                        message: error.message,
                        nsSeparator: undefined,
                    }),
                })
            },
        }
    )

    return {
        createValidation: createMutation.mutateAsync,
        isCreating: createMutation.isLoading,
        updateValidationRule: updateMutation.mutateAsync,
        isUpdating: updateMutation.isLoading,
        deleteValidation: deleteMutation.mutateAsync,
        isDeleting: deleteMutation.isLoading || deleteManyMutation.isLoading,
        updateValidationRules: updateManyMutation.mutateAsync,
        isUpdatingMany: updateManyMutation.isLoading,
        deleteValidations: deleteManyMutation.mutateAsync,
        applyBatch: batchMutation.mutateAsync,
        isApplyingBatch: batchMutation.isLoading,
        batchProgress,
    }
}
