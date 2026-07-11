import { useAlert, useDataEngine } from '@dhis2/app-runtime'
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
    createValidationForVariable,
    deleteRule,
    ProgramConfig,
    RuleServiceContext,
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
        }
    }

    const invalidateMetadata = () =>
        queryClient.invalidateQueries({
            queryKey: programMetadataQueryKey(programId),
        })

    const createMutation = useMutation<
        void,
        Error,
        { config: ValidationConfig; variable: Variable }
    >(
        async ({ config: validationConfig, variable }) => {
            await createValidationForVariable(
                buildCtx(),
                validationConfig,
                variable
            )
        },
        {
            onSuccess: () => {
                showCreated()
                invalidateMetadata()
            },
            onError: (error) => {
                showCreateError({ message: error.message })
            },
        }
    )

    const updateMutation = useMutation<
        void,
        Error,
        { ruleId: string; config: ValidationConfig; variable: Variable }
    >(
        async ({ ruleId, config: validationConfig, variable }) => {
            await updateValidation(buildCtx(), {
                ruleId,
                config: validationConfig,
                currentVariable: variable,
            })
        },
        {
            onSuccess: () => {
                showUpdated()
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
        isDeleting: deleteMutation.isLoading,
        applyBatch: batchMutation.mutateAsync,
        isApplyingBatch: batchMutation.isLoading,
        batchProgress,
    }
}
