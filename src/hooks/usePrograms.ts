import type { ProgramType } from '@/lib/types'
import { useApiDataQuery } from '@/utils/useApiDataQuery'

export interface ProgramListItem {
    id: string
    displayName: string
    programType?: ProgramType
}

interface ProgramsResponse {
    programs: ProgramListItem[]
}

export const usePrograms = () => {
    const { data, isLoading, error } = useApiDataQuery<ProgramsResponse>({
        queryKey: ['programs'],
        query: {
            resource: 'programs',
            params: {
                // Both programme types are supported: program rules and all
                // four feedback action types work without registration too.
                fields: 'id,displayName,programType',
                order: 'displayName:asc',
                paging: false,
            },
        },
        cacheTime: Infinity,
        staleTime: Infinity,
    })

    return { programs: data?.programs, isLoading, error }
}
