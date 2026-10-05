import { describe, expect, it } from 'vitest'
import { isNotFoundError } from '@/lib/errors'

describe('isNotFoundError', () => {
    it('recognises an app-runtime 404', () => {
        expect(
            isNotFoundError(
                Object.assign(new Error('x'), {
                    details: { httpStatusCode: 404 },
                })
            )
        ).toBe(true)
    })
    it.each([
        Object.assign(new Error('x'), { details: { httpStatusCode: 403 } }),
        Object.assign(new Error('x'), { details: { httpStatusCode: 500 } }),
        new Error('Failed to fetch'),
        undefined,
    ])('does not treat other failures as "not found" (%#)', (error) => {
        expect(isNotFoundError(error)).toBe(false)
    })
})
