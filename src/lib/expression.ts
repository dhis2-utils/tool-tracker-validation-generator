// Shared parsing helpers for d2:*Between(...) rule condition expressions

export interface BetweenExpression {
    unit: string
    ref1: string
    ref2: string
    op: string
    value: number
}

/** Strip a leading d2:hasValue(...) && guard from a condition */
export function stripNullGuard(condition: string): string {
    return condition.replace(/^d2:hasValue\([^)]+\)\s*&&\s*/, '')
}

/**
 * Depth-aware parser for `d2:<unit>Between(ref1, ref2) <op> <value>` that
 * tolerates nested function calls and quoted date literals in the refs.
 */
export function parseBetweenExpression(
    condition: string
): BetweenExpression | null {
    const trimmed = condition.trim()
    const fnMatch = trimmed.match(/^d2:(days|weeks|months|years)Between\(/)
    if (!fnMatch) {
        return null
    }

    const unit = fnMatch[1]
    let index = fnMatch[0].length
    let depth = 0
    let inQuote = false
    let splitIndex = -1
    let closeIndex = -1

    while (index < trimmed.length) {
        const char = trimmed[index]
        if (char === "'" && trimmed[index - 1] !== '\\') {
            inQuote = !inQuote
        } else if (!inQuote) {
            if (char === '(') {
                depth++
            }
            if (char === ')') {
                if (depth === 0) {
                    closeIndex = index
                    break
                }
                depth--
            }
            if (char === ',' && depth === 0 && splitIndex === -1) {
                splitIndex = index
            }
        }
        index++
    }

    if (splitIndex === -1 || closeIndex === -1) {
        return null
    }

    const ref1 = trimmed.slice(fnMatch[0].length, splitIndex).trim()
    const ref2 = trimmed.slice(splitIndex + 1, closeIndex).trim()
    const remainder = trimmed.slice(closeIndex + 1).trim()
    const comparatorMatch = remainder.match(/^(>=|<=|>|<|==|!=)\s*(-?\d+)$/)
    if (!comparatorMatch) {
        return null
    }

    return {
        unit,
        ref1,
        ref2,
        op: comparatorMatch[1],
        value: parseInt(comparatorMatch[2], 10),
    }
}

/**
 * Interval conditions (within N days/weeks/... before/after) place the
 * validated variable as either argument, so both must be considered when
 * attributing a rule to a variable.
 */
export function isIntervalExpression(expression: BetweenExpression): boolean {
    return (
        (expression.op === '>' && expression.value > 0) ||
        (expression.op === '<' && expression.value < 0)
    )
}
