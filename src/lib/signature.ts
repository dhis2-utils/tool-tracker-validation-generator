// The [DVT] / [DVT-BATCH] description tags that mark app-managed rules
import type { ProgramRule } from './types'

export function getAppSignature(): string {
    return 'DVT'
}

export function addAppSignature(
    ruleName: string,
    description?: string
): { name: string; description: string } {
    const signature = getAppSignature()
    const signaturePrefix = `[${signature}]`

    // Only add signature to description, not name
    const descWithSignature =
        description && !description.startsWith(signaturePrefix)
            ? `${signaturePrefix} ${description}`
            : description || `${signaturePrefix} Date validation rule`

    return { name: ruleName, description: descWithSignature }
}

export function isAppGenerated(rule: ProgramRule): boolean {
    const signature = getAppSignature()
    const signaturePrefix = `[${signature}]`

    // Check if the description starts with our signature
    return Boolean(
        rule.description && rule.description.startsWith(signaturePrefix)
    )
}

export const BATCH_TAG = 'DVT-BATCH'

export function isBatchGenerated(rule: ProgramRule): boolean {
    const batchPrefix = `[${BATCH_TAG}]`
    return (
        isAppGenerated(rule) && Boolean(rule.description?.includes(batchPrefix))
    )
}

export function addBatchSignature(
    ruleName: string,
    description?: string
): { name: string; description: string } {
    const { name, description: signedDesc } = addAppSignature(
        ruleName,
        description
    )
    const batchPrefix = `[${BATCH_TAG}]`
    // Return early if already tagged (idempotent)
    if (signedDesc.includes(batchPrefix)) {
        return { name, description: signedDesc }
    }
    const signature = getAppSignature()
    const descWithBatch = signedDesc.replace(
        new RegExp(`^\\[${signature}\\]\\s*`),
        `[${signature}] ${batchPrefix} `
    )
    return { name, description: descWithBatch }
}

export function removeAppSignature(text?: string): string {
    if (!text) {
        return text ?? ''
    }
    const signature = getAppSignature()
    const signaturePrefix = `[${signature}]`
    if (text.startsWith(signaturePrefix)) {
        return text.substring(signaturePrefix.length).trim()
    }
    return text
}

/**
 * Like removeAppSignature, but also strips a leading batch tag left behind
 * once the app tag is gone (batch-created rules are tagged
 * "[DVT] [DVT-BATCH] ..."). Individual (non-batch) rules only ever carry the
 * app tag, so this is a safe superset to use anywhere removeAppSignature is
 * used for display/comparison purposes.
 */
export function removeAllSignatures(text?: string): string {
    const withoutApp = removeAppSignature(text)
    const batchPrefix = `[${BATCH_TAG}]`
    return withoutApp.startsWith(batchPrefix)
        ? withoutApp.substring(batchPrefix.length).trim()
        : withoutApp
}
