import {
    createContext,
    ReactNode,
    useContext,
    useEffect,
    useMemo,
    useState,
} from 'react'
import type { BatchTemplate } from '@/lib/types'

interface BatchQueueValue {
    templates: BatchTemplate[]
    setTemplates: (templates: BatchTemplate[]) => void
}

const BatchQueueContext = createContext<BatchQueueValue>({
    templates: [],
    setTemplates: () => undefined,
})

/** Queued batch templates, kept per program (cleared on program change) */
export const BatchQueueProvider = ({
    programId,
    children,
}: {
    programId?: string
    children: ReactNode
}) => {
    const [templates, setTemplates] = useState<BatchTemplate[]>([])

    useEffect(() => {
        setTemplates([])
    }, [programId])

    const value = useMemo(() => ({ templates, setTemplates }), [templates])

    return (
        <BatchQueueContext.Provider value={value}>
            {children}
        </BatchQueueContext.Provider>
    )
}

export const useBatchQueue = () => useContext(BatchQueueContext)
