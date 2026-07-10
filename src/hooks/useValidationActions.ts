import { useDataEngine } from '@dhis2/app-runtime'
import i18n from '@dhis2/d2-i18n'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useFeedback } from './useFeedback'
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
    const { showSuccess, showError } = useFeedback()
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
                showSuccess(i18n.t('Validation rule created successfully'))
                invalidateMetadata()
            },
            onError: (error) => {
                showError(
                    i18n.t('Error creating validation rule: {{message}}', {
                        message: error.message,
                        nsSeparator: undefined,
                    })
                )
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
                showSuccess(i18n.t('Validation rule updated successfully'))
                invalidateMetadata()
            },
            onError: (error) => {
                showError(
                    i18n.t('Error updating validation rule: {{message}}', {
                        message: error.message,
                        nsSeparator: undefined,
                    })
                )
            },
        }
    )

    const deleteMutation = useMutation<void, Error, ExistingValidation>(
        (validation) => deleteRule(engine, validation),
        {
            onSuccess: () => {
                showSuccess(i18n.t('Validation rule deleted successfully'))
                invalidateMetadata()
            },
            onError: (error) => {
                showError(
                    i18n.t('Error deleting validation rule: {{message}}', {
                        message: error.message,
                        nsSeparator: undefined,
                    })
                )
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
                    showError(
                        i18n.t(
                            'Created {{count}} rule(s). {{skipped}} skipped: {{errors}}',
                            {
                                count: result.createdCount,
                                skipped: result.errors.length,
                                errors: result.errors.join('; '),
                                nsSeparator: undefined,
                            }
                        )
                    )
                } else if (result.createdCount === 1) {
                    showSuccess(
                        i18n.t(
                            'Created 1 validation rule from the queued bulk rules'
                        )
                    )
                } else {
                    showSuccess(
                        i18n.t(
                            'Created {{count}} validation rules from the queued bulk rules',
                            {
                                count: result.createdCount,
                            }
                        )
                    )
                }
            },
            onError: (error) => {
                showError(
                    i18n.t('Error applying bulk rules: {{message}}', {
                        message: error.message,
                        nsSeparator: undefined,
                    })
                )
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
