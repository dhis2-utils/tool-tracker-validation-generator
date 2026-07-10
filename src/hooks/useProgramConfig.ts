import { useAlert, useDataEngine } from '@dhis2/app-runtime'
import i18n from '@dhis2/d2-i18n'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ProgramConfig } from '@/services/rules'

// Same namespace as the original (pre-App Platform) version of this tool so
// existing per-program configurations keep working after upgrading.
const NAMESPACE = 'tracker-date-validation'

const DEFAULT_CONFIG: ProgramConfig = {
    programRulePrefix: '',
    programRuleVariablePrefix: '',
}

const configResource = (programId: string) =>
    `dataStore/${NAMESPACE}/config-${programId}`

export const useProgramConfig = (programId: string | undefined) => {
    const engine = useDataEngine()

    const { data, isLoading, error } = useQuery<ProgramConfig, Error>({
        queryKey: ['programConfig', programId],
        enabled: Boolean(programId),
        cacheTime: Infinity,
        staleTime: Infinity,
        queryFn: async () => {
            try {
                const response = await engine.query({
                    config: { resource: configResource(programId as string) },
                })
                return response.config as ProgramConfig
            } catch {
                // Key does not exist yet
                return DEFAULT_CONFIG
            }
        },
    })

    return { config: data ?? null, isLoading, error }
}

export const useSaveProgramConfig = (programId: string | undefined) => {
    const engine = useDataEngine()
    const queryClient = useQueryClient()
    const { show: showSuccess } = useAlert(
        i18n.t('Settings saved successfully'),
        {
            success: true,
        }
    )
    const { show: showError } = useAlert(
        ({ message }: { message: string }) =>
            i18n.t('Error saving settings: {{message}}', {
                message,
                nsSeparator: undefined,
            }),
        { critical: true }
    )

    const { mutate, isLoading: isSaving } = useMutation<
        void,
        Error,
        ProgramConfig
    >(
        async (config) => {
            try {
                // PUT /api/dataStore/<ns>/config-<programId>
                await engine.mutate({
                    resource: `dataStore/${NAMESPACE}`,
                    id: `config-${programId}`,
                    type: 'update',
                    data: config,
                } as Parameters<typeof engine.mutate>[0])
            } catch {
                // Key does not exist yet — create with POST
                await engine.mutate({
                    resource: configResource(programId as string),
                    type: 'create',
                    data: config,
                } as Parameters<typeof engine.mutate>[0])
            }
        },
        {
            onSuccess: (_data, config) => {
                queryClient.setQueryData(['programConfig', programId], config)
                showSuccess()
            },
            onError: (mutationError) => {
                showError({ message: mutationError.message })
            },
        }
    )

    return { saveConfig: mutate, isSaving }
}
