import { describe, expect, it } from 'vitest'
import {
    addBatchSignature,
    BATCH_TAG,
    isBatchGenerated,
    removeAllSignatures,
} from '@/lib/signature'
import { makeRule } from '@/test-utils/helpers'

describe('batch signature', () => {
    it('BATCH_TAG is the string DVT-BATCH', () => {
        expect(BATCH_TAG).toBe('DVT-BATCH')
    })

    it('addBatchSignature adds [DVT] and [DVT-BATCH] to description', () => {
        const result = addBatchSignature('My Rule', 'Some desc')
        expect(result.description.startsWith('[DVT]')).toBe(true)
        expect(result.description).toContain('[DVT-BATCH]')
    })

    it('addBatchSignature preserves the rule name', () => {
        const result = addBatchSignature('My Rule', 'Some desc')
        expect(result.name).toBe('My Rule')
    })

    it('isBatchGenerated returns true for batch-tagged rule', () => {
        const rule = makeRule({ description: '[DVT] [DVT-BATCH] Some desc' })
        expect(isBatchGenerated(rule)).toBe(true)
    })

    it('isBatchGenerated returns false for app rule without batch tag', () => {
        const rule = makeRule({ description: '[DVT] Some desc' })
        expect(isBatchGenerated(rule)).toBe(false)
    })

    it('addBatchSignature is idempotent (no duplicate tags)', () => {
        const result1 = addBatchSignature('Rule', 'desc')
        const result2 = addBatchSignature('Rule', result1.description)
        expect(result2.description).toBe(result1.description)
        expect((result2.description.match(/\[DVT-BATCH\]/g) || []).length).toBe(
            1
        )
    })

    it('isBatchGenerated requires [DVT] prefix, not just [DVT-BATCH] anywhere', () => {
        expect(
            isBatchGenerated(makeRule({ description: '[DVT-BATCH] desc' }))
        ).toBe(false)
    })
})

describe('removeAllSignatures', () => {
    it('strips both the app tag and the batch tag', () => {
        expect(removeAllSignatures('[DVT] [DVT-BATCH] Validates that X')).toBe(
            'Validates that X'
        )
    })

    it('strips just the app tag when there is no batch tag', () => {
        expect(removeAllSignatures('[DVT] Validates that X')).toBe(
            'Validates that X'
        )
    })

    it('leaves untagged text unchanged', () => {
        expect(removeAllSignatures('A custom description')).toBe(
            'A custom description'
        )
    })
})
