import { useAlert } from '@dhis2/app-runtime'

interface FeedbackProps {
    message: string
    type: 'success' | 'error' | 'info'
}

/** Toast-style feedback via the platform AlertBar stack */
export const useFeedback = () => {
    const { show } = useAlert(
        ({ message }: FeedbackProps) => message,
        ({ type }: FeedbackProps) =>
            type === 'error'
                ? { critical: true }
                : type === 'info'
                  ? { info: true }
                  : { success: true }
    )
    return {
        showSuccess: (message: string) => show({ message, type: 'success' }),
        showError: (message: string) => show({ message, type: 'error' }),
        showInfo: (message: string) => show({ message, type: 'info' }),
    }
}
