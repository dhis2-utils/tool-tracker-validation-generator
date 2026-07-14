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
    'selectEnrollmentDatesInFuture',
    'selectIncidentDatesInFuture',
    'programStages[id,name,executionDateLabel,hideDueDate,programStageDataElements[allowFutureDate,dataElement[id,name,valueType,optionSet[id]]]]',
    'trackedEntityType[trackedEntityTypeAttributes[id,name,valueType,optionSet[id]]]',
    'programTrackedEntityAttributes[allowFutureDate,trackedEntityAttribute[id,name,valueType,optionSet[id]]]',
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
                // Actions are fetched nested under their rules: filtering
                // programRuleActions by programRule.program.id returns 400 on
                // DHIS2 2.43 (the nested filter attribute no longer resolves).
                rules: {
                    resource: 'programRules',
                    params: {
                        filter: `program.id:eq:${programId}`,
                        fields: ':owner,programRuleActions[:owner]',
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
            })) as {
                program: Omit<
                    ProgramMetadata,
                    | 'programRules'
                    | 'programRuleVariables'
                    | 'programRuleActions'
                >
                rules: {
                    programRules?: (ProgramRule & {
                        programRuleActions?: ProgramRuleAction[]
                    })[]
                }
                variables: { programRuleVariables?: ProgramRuleVariable[] }
            }
            const rules = response.rules.programRules || []
            return {
                ...response.program,
                programRules: rules,
                programRuleVariables:
                    response.variables.programRuleVariables || [],
                programRuleActions: rules.flatMap(
                    (rule) => rule.programRuleActions || []
                ),
            }
        },
    })

    return { programMetadata: data ?? null, isLoading, error, refetch }
}
