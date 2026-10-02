// Classifying data-engine errors

/** True only for an HTTP 404 (app-runtime FetchError puts the parsed error
 * body, including httpStatusCode, in `details`). */
export function isNotFoundError(error: unknown): boolean {
    const details = (error as { details?: { httpStatusCode?: number } })
        ?.details
    return details?.httpStatusCode === 404
}
