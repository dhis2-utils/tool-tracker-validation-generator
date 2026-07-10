import { useApiDataQuery } from '@/utils/useApiDataQuery'

export interface ProgramListItem {
    id: string
    displayName: string
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
                fields: 'id,displayName',
                filter: 'programType:eq:WITH_REGISTRATION',
                order: 'displayName:asc',
                paging: false,
            },
        },
        cacheTime: Infinity,
        staleTime: Infinity,
    })

    return { programs: data?.programs, isLoading, error }
}
