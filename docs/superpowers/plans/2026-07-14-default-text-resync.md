# Default-Text Re-sync & Generator Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a rule is edited, regenerate its name/description/validation message if (and only if) each is still the auto-generated default; and collapse the two divergent default-text generators into one.

**Architecture:** Introduce one default-text source of truth (`getSuggestedRuleTexts`, projected from the existing `getValidationPreview`, with a stage-aware name). Route rule create + update through it. Teach `buildEditConfig` to null out any stored text that still equals the default so the form's existing "`null` = follow live suggestion" mechanism regenerates it. Delete the now-unused legacy generators.

**Tech Stack:** TypeScript, React 18, DHIS2 App Platform, Vitest. Pure domain logic lives in `src/lib/` (no React/engine imports); persistence in `src/services/rules.ts`.

## Global Constraints

- Business logic in `src/lib/` stays pure — no React, no data-engine imports.
- Strings persisted into DHIS2 metadata (rule names, descriptions, messages) are locale-independent English built from plain template literals — **not** `i18n.t()`.
- App-created rules are tagged `[DVT]` / `[DVT-BATCH]` in the description; `updateValidation` must preserve the existing tag (its `signatureFn` selection is unchanged).
- No existing installs / no legacy metadata to recognize — default detection compares against the single unified default only.
- Verify with `pnpm test`, `pnpm run lint`, `pnpm exec tsc --noEmit`.

---

### Task 1: Single default-text generator (`getSuggestedRuleTexts`) + stage-aware name

**Files:**

- Modify: `src/lib/validation.ts` (add `getVariableDisplayName`, use it in `getValidationPreview`'s `suggestedRuleName`, add `getSuggestedRuleTexts`)
- Test: `tests/validation.test.ts`

**Interfaces:**

- Produces:
    - `getVariableDisplayName(variable: Variable): string`
    - `getSuggestedRuleTexts(currentVariable: Variable, config: ValidationConfig, variables: Variable[] | null): { name: string; description: string; message: string }`

- [ ] **Step 1: Write the failing tests**

Add to `tests/validation.test.ts` (the fixtures `dateDE`, `numericDE`, `enrollment`, `allVariables` already exist near the top of the file). Append a new `describe` block:

```ts
describe('getSuggestedRuleTexts', () => {
    it('projects the three suggested texts for a date rule', () => {
        const texts = getSuggestedRuleTexts(
            dateDE,
            {
                operator: 'after',
                comparisonDateMode: 'fixed',
                fixedComparisonDate: '1900-01-01',
            },
            allVariables
        )
        expect(texts.name).toBe('Vaccination date must be after 1900-01-01')
        expect(texts.message).toBe('Vaccination date must be after 1900-01-01')
        expect(texts.description).toBe(
            'Validates that Vaccination date is entered after 1900-01-01'
        )
    })

    it('gives a numeric "between" name that carries both bounds', () => {
        const texts = getSuggestedRuleTexts(
            numericDE,
            {
                numericOperator: 'between',
                numericValue: 0,
                numericValueMax: 115,
            },
            allVariables
        )
        expect(texts.name).toBe('Age must be between 0 and 115 (inclusive)')
    })

    it('adds stage context to the name only, not the message', () => {
        const stageDate = makeVariable({
            type: 'dataElement',
            id: 'deStageAAAA',
            name: 'Vacc date',
            category: 'date',
            stageId: 'stgA',
            stageName: 'Stage A',
        })
        const texts = getSuggestedRuleTexts(
            stageDate,
            { operator: 'before', comparisonDateMode: 'current' },
            [stageDate]
        )
        expect(texts.name).toBe(
            'Vacc date (Stage A) must be before Current date'
        )
        expect(texts.message).toBe('Vacc date must be before Current date')
    })
})

describe('getVariableDisplayName', () => {
    it('appends stage name for stage-bound data elements', () => {
        expect(
            getVariableDisplayName(
                makeVariable({
                    type: 'dataElement',
                    name: 'Vacc date',
                    stageId: 'stgA',
                    stageName: 'Stage A',
                })
            )
        ).toBe('Vacc date (Stage A)')
    })

    it('returns the raw name when there is no stage name', () => {
        expect(
            getVariableDisplayName(
                makeVariable({ type: 'enrollment', name: 'Enrollment date' })
            )
        ).toBe('Enrollment date')
    })
})
```

Add `getSuggestedRuleTexts` and `getVariableDisplayName` to the existing import from `@/lib/validation` at the top of `tests/validation.test.ts`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- validation`
Expected: FAIL — `getSuggestedRuleTexts`/`getVariableDisplayName` are not exported.

- [ ] **Step 3: Implement in `src/lib/validation.ts`**

Add the display-name helper (place it just above `getValidationPreview`):

```ts
export function getVariableDisplayName(variable: Variable): string {
    if (
        variable.stageName &&
        ['dataElement', 'event_date', 'due_date'].includes(variable.type)
    ) {
        return `${variable.name} (${variable.stageName})`
    }
    return variable.name
}
```

In `getValidationPreview`, make **only the name** stage-aware. There are three
places that build a `suggestedRuleName`; in each, use the display name instead of
the raw name. For the numeric branch, after `const varName = currentVariable.name`
add:

```ts
const varDisplayName = getVariableDisplayName(currentVariable)
```

and change every `suggestedRuleName: \`${varName} ...\`` to use `${varDisplayName}`(the`preview`, `suggestedMessage`, and `suggestedDescription`keep`${varName}`).

For the date branch, after `const variableName = currentVariable.name` add:

```ts
const variableDisplayName = getVariableDisplayName(currentVariable)
```

and change every `suggestedRuleName: \`${variableName} ...\`` to use
`${variableDisplayName}`(again,`preview`/`suggestedMessage`/
`suggestedDescription`keep`${variableName}`). This covers the between branch and
the before/after/on-or-\* branch and the within branch.

Then add the projection helper at the end of the file:

```ts
export function getSuggestedRuleTexts(
    currentVariable: Variable,
    config: ValidationConfig,
    variables: Variable[] | null
): { name: string; description: string; message: string } {
    const p = getValidationPreview(currentVariable, config, variables)
    return {
        name: p.suggestedRuleName,
        description: p.suggestedDescription,
        message: p.suggestedMessage,
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- validation`
Expected: PASS (new block passes; existing `getValidationPreview` tests still pass — `dateDE`/`numericDE` have no `stageName`, so names are unchanged there).

- [ ] **Step 5: Commit**

```bash
git add src/lib/validation.ts tests/validation.test.ts
git commit -m "feat: single default-text generator with stage-aware names

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Route create + update through the unified generator

**Files:**

- Modify: `src/services/rules.ts`
- Test: `tests/services-rules.test.ts`

**Interfaces:**

- Consumes: `getSuggestedRuleTexts` from Task 1.
- Produces: no new exports; behavior change — default rule name/description/message everywhere come from `getSuggestedRuleTexts`.

- [ ] **Step 1: Update the failing assertion first**

In `tests/services-rules.test.ts`, the `updateValidation — group/bulk edits` test asserts the regenerated name in the old style. Change the expectation (near the end of that test):

```ts
expect(ruleUpdate?.data.name).toBe(
    'Vacc date (Stage A) must be on or before Current date'
)
```

(Leave the input fixture's stored `name`/`description` as-is — the group edit regenerates the name regardless of the stored value.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- services-rules`
Expected: FAIL — received is still `'Date validation: Vacc date (Stage A) should be on or before Current date'`.

- [ ] **Step 3: Reroute `src/services/rules.ts`**

Update the import block: from `@/lib/validation` **remove** `generateDefaultDescription`, `generateDefaultNumericDescription`, `generateDefaultNumericMessage` and **add** `getSuggestedRuleTexts`. From `@/lib/builder` **remove** `generateRuleName`. The resulting imports:

```ts
import {
    generateBetweenDateCondition,
    generateNewRuleCondition,
    generateNumericBetweenCondition,
    generateNumericCondition,
    generateNumericFieldCondition,
} from '@/lib/builder'
```

```ts
import {
    getSuggestedRuleTexts,
    resolveDateComparisonTarget,
    resolveUpperDateComparisonTarget,
} from '@/lib/validation'
```

**`createDateValidationForVariable`** — replace the duplicate-name probe and the default-text block. The existing `finalRuleName` (used for the "already exists" check) and the later `actualName`/`defaultDesc`/`defaultMessage` all collapse into one `suggested`. Compute it right after `compareDate` is resolved:

```ts
const suggested = getSuggestedRuleTexts(targetVariable, config, variables)
```

Change the duplicate-name probe to:

```ts
const finalRuleName = config.ruleName || suggested.name
const existingRule = metadata.programRules.find(
    (rule) => rule.name === finalRuleName
)
if (existingRule) {
    throw new Error(`Rule "${finalRuleName}" already exists`)
}
```

Delete the old `const actualName = generateRuleName(...)` line and its
`defaultDesc`/`defaultMessage` lines, and build the persisted values from
`suggested`:

```ts
const ruleName = prefix ? `${prefix} - ${finalRuleName}` : finalRuleName
const { description } = signatureFn(
    ruleName,
    config.ruleDescription || suggested.description
)
```

and the action content:

```ts
        content: config.ruleMessage || suggested.message,
```

**`createNumericValidationForVariable`** — same shape. After `compareField` is resolved and before building the rule, add:

```ts
const suggested = getSuggestedRuleTexts(targetVariable, config, variables)
```

Replace `ruleNameBase`:

```ts
const ruleNameBase = config.ruleName || suggested.name
```

Delete the `generateDefaultNumericDescription` line; replace with:

```ts
const { description } = signatureFn(
    ruleName,
    config.ruleDescription || suggested.description
)
```

Replace the action `content` (currently `config.ruleMessage || generateDefaultNumericMessage(...)`) with:

```ts
        content: config.ruleMessage || suggested.message,
```

**`updateValidation`** — compute `suggested` once near the top, right after
destructuring `variables`:

```ts
const suggested = getSuggestedRuleTexts(currentVariable, config, variables)
```

In the **numeric branch**, replace `ruleNameBase` and `defaultDesc`:

```ts
const ruleNameBase = config.ruleName || suggested.name
const ruleName = prefix ? `${prefix} - ${ruleNameBase}` : ruleNameBase
const { description } = signatureFn(
    ruleName,
    config.ruleDescription || suggested.description
)
```

In the **date branch**, replace the duplicate-name probe's `finalRuleName` and the default description:

```ts
const finalRuleName = config.ruleName || suggested.name
```

(keep the surrounding duplicate checks that reference `finalRuleName`), and:

```ts
const { description } = signatureFn(
    ruleName,
    config.ruleDescription || suggested.description
)
```

Finally, give the action content a fallback (currently `content: config.ruleMessage`):

```ts
const updatedAction: ProgramRuleAction = {
    ...existingAction,
    programRuleActionType:
        config.actionType || existingAction.programRuleActionType,
    content: config.ruleMessage || suggested.message,
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test -- services-rules`
Expected: PASS.

- [ ] **Step 5: Type-check (catches unused/renamed symbols)**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/services/rules.ts tests/services-rules.test.ts
git commit -m "refactor: create/update default texts via unified generator

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Per-field default detection in `buildEditConfig`

**Files:**

- Modify: `src/lib/validation.ts` (`buildEditConfig` signature + body)
- Modify: `src/pages/DetailsPage.tsx`, `src/pages/RulesPage.tsx` (pass `variables`)
- Test: `tests/validation.test.ts`

**Interfaces:**

- Consumes: `getSuggestedRuleTexts` (Task 1).
- Produces: new signature
  `buildEditConfig(parsed, rule, action, currentVariable, variables, programRulePrefix?)`.

- [ ] **Step 1: Write the failing tests**

In `tests/validation.test.ts`, first update the existing 6 `buildEditConfig` calls to pass `allVariables` before the optional prefix:

- `buildEditConfig(parsed!, rule, action, dateDE, 'EIR')` → `buildEditConfig(parsed!, rule, action, dateDE, allVariables, 'EIR')`
- the four `buildEditConfig(parsed!, rule, action, dateDE)` / `(..., numericDE)` calls → add `, allVariables` as the 5th arg.

Then append new cases inside the existing `describe('buildEditConfig', ...)` block:

```ts
it('nulls out texts that still match the generated default', () => {
    // Stored texts equal exactly what the generator would produce for
    // this "after 1900-01-01" rule, so they should be treated as default.
    const rule = makeRule({
        name: 'Vaccination date must be after 1900-01-01',
        description:
            '[DVT] Validates that Vaccination date is entered after 1900-01-01',
        condition:
            "d2:hasValue(#{PRV_VACC}) && d2:daysBetween(#{PRV_VACC}, '1900-01-01') > 0",
    })
    const defaultAction: ProgramRuleAction = {
        ...action,
        content: 'Vaccination date must be after 1900-01-01',
    }
    const parsed = parseRuleCondition(rule.condition, meta, dateDE)
    const config = buildEditConfig(
        parsed!,
        rule,
        defaultAction,
        dateDE,
        allVariables
    )
    expect(config.ruleName).toBeUndefined()
    expect(config.ruleDescription).toBeUndefined()
    expect(config.ruleMessage).toBeUndefined()
})

it('keeps texts that were customized away from the default', () => {
    const rule = makeRule({
        name: 'Vaccination date must be after 1900-01-01',
        description: '[DVT] A custom description',
        condition:
            "d2:hasValue(#{PRV_VACC}) && d2:daysBetween(#{PRV_VACC}, '1900-01-01') > 0",
    })
    const mixedAction: ProgramRuleAction = {
        ...action,
        content: 'A custom message',
    }
    const parsed = parseRuleCondition(rule.condition, meta, dateDE)
    const config = buildEditConfig(
        parsed!,
        rule,
        mixedAction,
        dateDE,
        allVariables
    )
    // Name matches the default → nulled; description/message customized → kept.
    expect(config.ruleName).toBeUndefined()
    expect(config.ruleDescription).toBe('A custom description')
    expect(config.ruleMessage).toBe('A custom message')
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test -- validation`
Expected: FAIL — arity/behavior mismatch (the two new cases fail; the updated existing calls compile once the impl accepts `variables`).

- [ ] **Step 3: Rewrite `buildEditConfig` in `src/lib/validation.ts`**

Replace the whole function. Build the structural config first, compute the suggestion from it, then decide each text:

```ts
export function buildEditConfig(
    parsed: ParsedRuleCondition,
    rule: ProgramRule,
    action: ProgramRuleAction,
    currentVariable: Variable,
    variables: Variable[] | null,
    programRulePrefix?: string
): ValidationConfig {
    let strippedName = rule.name
    if (
        programRulePrefix &&
        strippedName.startsWith(`${programRulePrefix} - `)
    ) {
        strippedName = strippedName.substring(programRulePrefix.length + 3)
    }
    const strippedDesc = removeAppSignature(rule.description || '')
    const storedMessage = action.content || ''

    let structural: ValidationConfig
    if (currentVariable.category === 'numeric') {
        structural = {
            numericOperator: parsed.config.operator,
            numericComparisonType:
                parsed.config.comparisonType === 'field' ? 'field' : 'value',
            numericValue: parsed.config.value ?? null,
            numericValueMax: parsed.config.valueMax ?? null,
            numericComparisonField: parsed.variable2
                ? getVariableKey(parsed.variable2)
                : '',
        }
    } else {
        const lower = mapDateVariableToFields(parsed.variable2)
        if (parsed.config.operator === 'between') {
            const upper = mapDateVariableToFields(parsed.variable3 ?? null)
            structural = {
                operator: 'between',
                comparisonDateMode: lower.mode,
                comparisonDate: lower.comparisonDate,
                fixedComparisonDate: lower.fixedComparisonDate,
                relativeComparisonAmount: lower.relativeAmount,
                relativeComparisonUnit: lower.relativeUnit,
                relativeComparisonDirection: lower.relativeDirection,
                upperComparisonDateMode: upper.mode,
                upperComparisonDate: upper.comparisonDate,
                upperFixedComparisonDate: upper.fixedComparisonDate,
                upperRelativeComparisonAmount: upper.relativeAmount,
                upperRelativeComparisonUnit: upper.relativeUnit,
                upperRelativeComparisonDirection: upper.relativeDirection,
            }
        } else {
            structural = {
                operator: parsed.config.operator,
                comparisonDateMode: lower.mode,
                comparisonDate: lower.comparisonDate,
                fixedComparisonDate: lower.fixedComparisonDate,
                relativeComparisonAmount: lower.relativeAmount,
                relativeComparisonUnit: lower.relativeUnit,
                relativeComparisonDirection: lower.relativeDirection,
                intervalAmount: parsed.config.intervalAmount ?? null,
                intervalUnit: parsed.config.intervalUnit || 'days',
            }
        }
    }

    const suggested = getSuggestedRuleTexts(
        currentVariable,
        structural,
        variables
    )
    return {
        ...structural,
        ruleName: strippedName === suggested.name ? undefined : strippedName,
        ruleDescription:
            strippedDesc === suggested.description ? undefined : strippedDesc,
        ruleMessage:
            storedMessage === suggested.message ? undefined : storedMessage,
        actionType: action.programRuleActionType || 'SHOWERROR',
    }
}
```

- [ ] **Step 4: Update the call sites**

`src/pages/DetailsPage.tsx` — the `buildEditConfig` call inside `startEditing`:

```ts
            config: buildEditConfig(
                parsed,
                validation.rule,
                action,
                variable,
                variables,
                config?.programRulePrefix
            ),
```

`src/pages/RulesPage.tsx` — both calls. In the `useMemo` grouping block:

```ts
const cfg = buildEditConfig(
    parsed,
    validation.rule,
    action,
    variable,
    variables,
    config?.programRulePrefix
)
```

and in `seedConfigFor`:

```ts
const cfg = buildEditConfig(
    parsed,
    row.validation.rule,
    action,
    row.variable,
    variables,
    config?.programRulePrefix
)
```

- [ ] **Step 5: Run tests + type-check**

Run: `pnpm test -- validation && pnpm exec tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/validation.ts src/pages/DetailsPage.tsx src/pages/RulesPage.tsx tests/validation.test.ts
git commit -m "feat: regenerate default rule texts on edit, preserve customized ones

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Delete the now-dead generators

**Files:**

- Modify: `src/lib/builder.ts` (remove `generateRuleName`, `generateValidationMessage`, `getValidationStageId`)
- Modify: `src/lib/validation.ts` (remove `generateDefaultDescription`, `generateDefaultNumericMessage`, `generateDefaultNumericDescription`)
- Test: `tests/builder.test.ts` (remove `generateRuleName` test + import)

**Interfaces:**

- Consumes: nothing new. All removed symbols are unused after Tasks 2–3.

- [ ] **Step 1: Confirm each symbol is unused in `src/`**

Run:

```bash
grep -rn "generateRuleName\|generateValidationMessage\|getValidationStageId\|generateDefaultDescription\|generateDefaultNumericMessage\|generateDefaultNumericDescription" src
```

Expected: only the definitions in `src/lib/builder.ts` / `src/lib/validation.ts` (no call sites). If any call site remains, it belongs to a prior task — fix there first.

- [ ] **Step 2: Remove the functions**

In `src/lib/builder.ts`, delete:

- `generateRuleName` (lines ~143–180, includes the `difference_*` label map),
- `generateValidationMessage` (lines ~182–197, includes the `difference_*` branch),
- `getValidationStageId` (lines ~199–210).

In `src/lib/validation.ts`, delete:

- `generateDefaultDescription`,
- `generateDefaultNumericDescription`,
- `generateDefaultNumericMessage`.

In `tests/builder.test.ts`, remove `generateRuleName` from the import list and delete the entire `describe('generateRuleName', ...)` block.

- [ ] **Step 3: Full verification suite**

Run:

```bash
pnpm exec tsc --noEmit && pnpm run lint && pnpm test
```

Expected: type-check clean (no unused-export or missing-symbol errors), lint clean, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/builder.ts src/lib/validation.ts tests/builder.test.ts
git commit -m "chore: remove unused legacy default-text generators

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Manual end-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Regenerate i18n if any user-facing `i18n.t` strings changed**

This change touches only metadata-persisted English strings (no `i18n.t`), so this should be a no-op. Confirm:

```bash
pnpm run build 2>/dev/null; git status --porcelain i18n
```

Expected: no changes under `i18n/`. (If there are, run the project's i18n extract script and commit as `chore: regenerate i18n strings`.)

- [ ] **Step 2: Drive the app against a test instance**

Use the `verify` / `run` skill (or `pnpm start --proxy <url>`) and confirm the scenario from the spec:

1. Create a bulk date rule "after 1900-01-01" over date fields.
2. Open one field's details, change the bound to 2000-01-01, save. Confirm the rule **name, description, and validation message** now read "2000-01-01".
3. Repeat, but first rename the rule, then change the bound. Confirm the **name is preserved** while description/message update.
4. Confirm a bulk "between" rule's name now shows **both** bounds.

- [ ] **Step 3: Note results**

Record the observed behavior for the review. No commit.

---

## Self-Review

**Spec coverage:**

- §1 single generator → Task 1 (`getSuggestedRuleTexts`) + stage-aware name note → Task 1 (`getVariableDisplayName`). ✔
- §2 route create+update → Task 2 (incl. duplicate-name probes and action-content fallback). ✔
- §3 per-field detection in `buildEditConfig` → Task 3. ✔
- §4 no form changes → confirmed (no form file touched). ✔
- Dead-code removal → Task 4. ✔
- Call sites (DetailsPage, RulesPage) → Task 3 Step 4. ✔
- Tests (validation, builder, services-rules) → Tasks 1–4. ✔
- Verification → Task 5. ✔

**Placeholder scan:** No TBD/TODO; every code step shows the code and exact commands.

**Type consistency:** `getSuggestedRuleTexts(currentVariable, config, variables)` and `getVariableDisplayName(variable)` are used with the same signatures in Tasks 2–3 as defined in Task 1. `buildEditConfig`'s new 6-arg signature matches all call sites (DetailsPage, RulesPage ×2) and all test calls updated in Task 3 Step 1.
