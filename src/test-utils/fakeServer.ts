// Test-only in-memory DHIS2 metadata server behind the DataEngine interface,
// modelled on the behaviour verified live on 2.42 (see docs/review-2026-10-02-
// rule-logic): /api/metadata imports are atomic (any error → nothing stored,
// 409 with error reports), rule names are unique per programme, deleting a
// rule deletes its actions, and an update replaces the rule's action list.
import type {
    ProgramRule,
    ProgramRuleAction,
    ProgramRuleVariable,
} from '@/lib/types'
import type { DataEngine } from '@/services/rules'

type StoredRule = ProgramRule & { programRuleActions?: { id: string }[] }

export interface FakeServer extends DataEngine {
    rules: Map<string, StoredRule>
    actions: Map<string, ProgramRuleAction>
    prvs: Map<string, ProgramRuleVariable>
    calls: { resource: string; type: string }[]
    /** Make the next N metadata imports fail with this error message. */
    failNextImports: (count: number, message?: string) => void
    /** DHIS2 2.42.6 bug (verified live): once a rule has been read, a metadata
     * UPDATE carrying an action without a data element / attribute fails
     * with a 500 NullPointerException (nothing is stored). */
    simulateFieldlessActionUpdateBug: boolean
    /** Make JSON-patch requests on this resource fail. */
    failPatchesOn: string | null
}

const conflict = (message: string, extra: Record<string, unknown> = {}) =>
    Object.assign(new Error(message), {
        details: {
            httpStatusCode: 409,
            status: 'WARNING',
            response: {
                status: 'ERROR',
                stats: { created: 0, updated: 0, ignored: 1 },
                typeReports: [
                    {
                        objectReports: [
                            { errorReports: [{ message, ...extra }] },
                        ],
                    },
                ],
                errorReports: [{ message, ...extra }],
            },
        },
    })

export function fakeServer(): FakeServer {
    let uid = 0
    let failures = 0
    let failureMessage = 'Import failed'
    const rules = new Map<string, StoredRule>()
    const actions = new Map<string, ProgramRuleAction>()
    const prvs = new Map<string, ProgramRuleVariable>()
    const calls: { resource: string; type: string }[] = []

    const nextUid = () => `uid${String(++uid).padStart(8, '0')}`

    const server: FakeServer = {
        rules,
        actions,
        prvs,
        calls,
        failNextImports: (count, message = 'Import failed') => {
            failures = count
            failureMessage = message
        },
        simulateFieldlessActionUpdateBug: false,
        failPatchesOn: null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        query: async (query: any) => {
            const [key] = Object.keys(query)
            const q = query[key]
            if (q.resource === 'system/id') {
                const limit = q.params?.limit ?? 1
                return {
                    [key]: { codes: Array.from({ length: limit }, nextUid) },
                }
            }
            if (q.resource === 'programRules' && q.id) {
                const rule = rules.get(q.id)
                if (!rule) {
                    throw Object.assign(new Error('404'), {
                        details: { httpStatusCode: 404 },
                    })
                }
                return {
                    [key]: {
                        ...rule,
                        programRuleActions: (rule.programRuleActions ?? []).map(
                            (a) => ({ ...actions.get(a.id)! })
                        ),
                    },
                }
            }
            if (q.resource === 'programRuleVariables') {
                const nameFilter = (q.params?.filter ?? []).find((f: string) =>
                    f.startsWith('name:eq:')
                )
                const name = nameFilter?.slice('name:eq:'.length)
                return {
                    [key]: {
                        programRuleVariables: [...prvs.values()].filter(
                            (p) => p.name === name
                        ),
                    },
                }
            }
            throw new Error(`unexpected query ${q.resource}`)
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mutate: async (mutation: any) => {
            calls.push({ resource: mutation.resource, type: mutation.type })
            if (mutation.resource === 'programRuleVariables') {
                if (mutation.type === 'create') {
                    const prv = mutation.data as ProgramRuleVariable
                    if ([...prvs.values()].some((p) => p.name === prv.name)) {
                        throw conflict('name exists', { errorCode: 'E4051' })
                    }
                    prvs.set(prv.id!, { ...prv })
                    return {}
                }
                if (mutation.type === 'delete') {
                    prvs.delete(mutation.id)
                    return {}
                }
            }
            if (
                mutation.resource === 'programRules' &&
                mutation.type === 'delete'
            ) {
                const rule = rules.get(mutation.id)
                for (const a of rule?.programRuleActions ?? []) {
                    actions.delete(a.id)
                }
                rules.delete(mutation.id)
                return {}
            }
            if (mutation.type === 'json-patch') {
                if (server.failPatchesOn === mutation.resource) {
                    throw Object.assign(new Error('500'), {
                        details: { httpStatusCode: 500 },
                    })
                }
                const store =
                    mutation.resource === 'programRules'
                        ? rules
                        : mutation.resource === 'programRuleActions'
                          ? actions
                          : null
                const target = store?.get(mutation.id) as
                    | Record<string, unknown>
                    | undefined
                if (!target) {
                    throw Object.assign(new Error('404'), {
                        details: { httpStatusCode: 404 },
                    })
                }
                for (const op of mutation.data as {
                    op: string
                    path: string
                    value: unknown
                }[]) {
                    if (op.op !== 'replace' && op.op !== 'add') {
                        throw new Error(`unsupported op ${op.op}`)
                    }
                    target[op.path.replace(/^\//, '')] = op.value
                }
                return {}
            }
            if (
                mutation.resource === 'metadata' &&
                mutation.type === 'create'
            ) {
                const importActions =
                    (
                        mutation.data as {
                            programRuleActions?: ProgramRuleAction[]
                        }
                    ).programRuleActions ?? []
                if (
                    server.simulateFieldlessActionUpdateBug &&
                    mutation.params?.importStrategy === 'UPDATE' &&
                    importActions.some(
                        (a) => !a.dataElement && !a.trackedEntityAttribute
                    )
                ) {
                    throw Object.assign(new Error('500'), {
                        details: {
                            httpStatusCode: 500,
                            message:
                                'Cannot invoke "org.hisp.dhis.programrule.ProgramRule.getProgram()" because "rule" is null',
                        },
                    })
                }
                if (failures > 0) {
                    failures--
                    throw conflict(failureMessage)
                }
                const strategy = mutation.params?.importStrategy
                const data = mutation.data as {
                    programRules?: StoredRule[]
                    programRuleActions?: ProgramRuleAction[]
                }
                for (const rule of data.programRules ?? []) {
                    const clash = [...rules.values()].find(
                        (r) => r.name === rule.name && r.id !== rule.id
                    )
                    if (clash) {
                        throw conflict(
                            `The Program Rule name ${rule.name} already exist`
                        )
                    }
                    if (strategy === 'CREATE' && rules.has(rule.id)) {
                        throw conflict('exists')
                    }
                    if (strategy === 'UPDATE' && !rules.has(rule.id)) {
                        throw conflict('missing')
                    }
                }
                let created = 0
                let updated = 0
                for (const rule of data.programRules ?? []) {
                    const existing = rules.get(rule.id)
                    if (existing) {
                        // the rule's action list is replaced: actions not listed are deleted
                        const keep = new Set(
                            (rule.programRuleActions ?? []).map((a) => a.id)
                        )
                        for (const a of existing.programRuleActions ?? []) {
                            if (!keep.has(a.id)) {
                                actions.delete(a.id)
                            }
                        }
                        updated++
                    } else {
                        created++
                    }
                    rules.set(rule.id, { ...rule })
                }
                for (const action of data.programRuleActions ?? []) {
                    if (actions.has(action.id)) {
                        updated++
                    } else {
                        created++
                    }
                    actions.set(action.id, { ...action })
                }
                return {
                    httpStatusCode: 200,
                    status: 'OK',
                    response: {
                        status: 'OK',
                        stats: {
                            created,
                            updated,
                            deleted: 0,
                            ignored: 0,
                            total: created + updated,
                        },
                    },
                }
            }
            throw new Error(
                `unexpected mutation ${mutation.resource} ${mutation.type}`
            )
        },
    }
    return server
}
