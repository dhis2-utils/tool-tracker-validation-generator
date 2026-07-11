import { useMemo } from 'react'
import { useProgramConfig } from './useProgramConfig'
import { useProgramMetadata } from './useProgramMetadata'
import { buildVariablesArray } from '@/lib/variables'

/** Metadata + per-program config + derived variable list for one program */
export const useProgramData = (programId: string | undefined) => {
    const {
        programMetadata,
        isLoading: isLoadingMetadata,
        error: metadataError,
    } = useProgramMetadata(programId)
    const { config, isLoading: isLoadingConfig } = useProgramConfig(programId)

    const variables = useMemo(
        () => buildVariablesArray(programMetadata),
        [programMetadata]
    )

    return {
        programMetadata,
        config,
        variables,
        isLoading: isLoadingMetadata || isLoadingConfig,
        error: metadataError,
    }
}
