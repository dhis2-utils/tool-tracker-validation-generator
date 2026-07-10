import { useDataEngine } from '@dhis2/app-runtime'
import { useQuery } from '@tanstack/react-query'
import type {
    ProgramMetadata,
    ProgramRule,
    ProgramRuleAction,
    ProgramRuleVariable,
} from '@/lib/types'

// `name` (not displayName) is fetched deliberately for stages, data elements
// and attributes: generated rule and PRV names must be locale-independent.
const PROGRAM_FIELDS = [
    'id',
    'name',
    'displayName',
    'enrollmentDateLabel',
    'incidentDateLabel',
    'displayIncidentDate',
    'ignoreOverdueEvents',
    'programStages[id,name,executionDateLabel,hideDueDate,programStageDataElements[dataElement[id,name,valueType]]]',
    'trackedEntityType[trackedEntityTypeAttributes[id,name,valueType]]',
    'programTrackedEntityAttributes[trackedEntityAttribute[id,name,valueType]]',
].join(',')

export const programMetadataQueryKey = (programId: string | undefined) => [
    'programMetadata',
    programId,
]

export const useProgramMetadata = (programId: string | undefined) => {
    const engine = useDataEngine()

    const { data, isLoading, error, refetch } = useQuery<
        ProgramMetadata,
        Error
    >({
        queryKey: programMetadataQueryKey(programId),
        enabled: Boolean(programId),
        // Metadata changes only through this app's own mutations, which
        // invalidate this key — avoid refetching on every focus.
        staleTime: 5 * 60 * 1000,
        cacheTime: 10 * 60 * 1000,
        queryFn: async () => {
            const response = (await engine.query({
                program: {
                    resource: 'programs',
                    id: programId as string,
                    params: { fields: PROGRAM_FIELDS },
                },
                rules: {
                    resource: 'programRules',
                    params: {
                        filter: `program.id:eq:${programId}`,
                        fields: ':owner',
                        paging: false,
                    },
                },
                variables: {
                    resource: 'programRuleVariables',
                    params: {
                        filter: `program.id:eq:${programId}`,
                        fields: ':owner',
                        paging: false,
                    },
                },
                actions: {
                    resource: 'programRuleActions',
                    params: {
                        filter: `programRule.program.id:eq:${programId}`,
                        fields: ':owner',
                        paging: false,
                    },
                },
            })) as {
                program: Omit<
                    ProgramMetadata,
                    | 'programRules'
                    | 'programRuleVariables'
                    | 'programRuleActions'
                >
                rules: { programRules?: ProgramRule[] }
                variables: { programRuleVariables?: ProgramRuleVariable[] }
                actions: { programRuleActions?: ProgramRuleAction[] }
            }
            return {
                ...response.program,
                programRules: response.rules.programRules || [],
                programRuleVariables:
                    response.variables.programRuleVariables || [],
                programRuleActions: response.actions.programRuleActions || [],
            }
        },
    })

    return { programMetadata: data ?? null, isLoading, error, refetch }
}
