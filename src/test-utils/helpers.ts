import type { ProgramMetadata, ProgramRule, Variable } from '@/lib/types'

export const makeMeta = (
    partial: Partial<ProgramMetadata> = {}
): ProgramMetadata => ({
    id: 'prog1234567',
    name: 'Test programme',
    programRules: [],
    programRuleVariables: [],
    programRuleActions: [],
    ...partial,
})

export const makeRule = (partial: Partial<ProgramRule> = {}): ProgramRule => ({
    id: 'rule001AAAA',
    name: 'Test rule',
    condition: '',
    ...partial,
})

export const makeVariable = (
    partial: Partial<Variable> & Pick<Variable, 'type'>
): Variable => ({
    id: 'var01AAAAAA',
    name: 'Test variable',
    ...partial,
})
