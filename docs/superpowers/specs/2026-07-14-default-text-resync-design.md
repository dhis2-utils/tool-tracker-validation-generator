# Re-sync default rule texts on edit; unify default-text generation

**Date:** 2026-07-14
**Status:** Approved (design)

## Problem

When a user edits an existing validation rule and changes its bound (e.g. a rule
"date should be after 1900-01-01" changed to "after 2000-01-01" for one data
element), the rule **condition** updates but the rule **name**, **description**,
and **validation message** stay frozen at the old text. The user expects those
three texts to update too — *as long as they are still the auto-generated
defaults*. If the user has customized a text, it must be preserved.

### Root cause

`ValidationForm` already models each text as `string | null`, where `null` means
"follow the live auto-generated suggestion". New rules start `null`, so they
regenerate as the bound changes — the desired behavior.

`buildEditConfig` (`src/lib/validation.ts`) breaks this on edit: it pre-fills all
three fields with the *stored* strings, so the form treats them as "customized"
even when they are untouched defaults.

### Secondary issue: two default-text generators

Default text is generated two different ways depending on how a rule was created:

- `getValidationPreview` (`validation.ts`) — the form's live suggestions, used by
  individually-created rules. Produces `"X must be after Y"`.
- `generateRuleName` / `generateDefaultDescription` /
  `generateDefaultNumericMessage` / `generateDefaultNumericDescription`
  (`builder.ts` + `validation.ts`) — fallbacks used by **bulk** creation and
  group-edit regeneration. Produces `"Date validation: X should be after Y"`.

This drift means bulk and individual rules read differently. The bulk generators
are also **buggy for "between"**: both `generateRuleName` (date) and
`generateDefaultNumericMessage` (numeric) drop the upper/max bound from the name.

There are **no existing installs**, so no legacy metadata needs to be recognized.
We can collapse to one generator outright and delete the others.

## Design

### 1. Single source of truth for default texts

Add to `src/lib/validation.ts`:

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

`getValidationPreview` remains the single place the text is computed; the new
helper is a thin projection of its `suggested*` fields. It handles date and
numeric, all operators, and the correct "between … and … (inclusive)" phrasing —
fixing both between-naming bugs as a side effect.

**Stage-aware names (uniqueness).** The old bulk generator appended stage
context to the *name* (`"Vacc date (Stage A) must be …"`) so that same-named
fields in different stages get distinct, unique rule names (DHIS2 rejects
duplicate names). `getValidationPreview` currently uses the raw variable name, so
the unification must preserve stage-awareness for the **name only**. Add a small
helper and use it when building `suggestedRuleName`:

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

This applies to date and numeric names alike (also closing a latent
cross-stage collision for numeric bulk rules, whose old generator had no stage
context). The `preview` field and `suggestedMessage`/`suggestedDescription` keep
the raw name: `preview` must stay raw so `RulesPage` grouping (which strips the
leading `variable.name`) still works, and messages/descriptions need no
uniqueness. Only variables that carry a `stageName` get a suffix, so existing
enrollment/attribute names are unchanged.

Note: `getValidationPreview` returns empty strings for an incomplete config. The
create/update paths only run with complete, validated configs, so
`config.ruleX || suggested.x` always yields non-empty text there.

### 2. Route create + update through the helper (`src/services/rules.ts`)

Replace every `generate*` default with `getSuggestedRuleTexts`:

- `createDateValidationForVariable` and `createNumericValidationForVariable`:
  - `ruleName`  = `config.ruleName || suggested.name`
  - `description` = `signatureFn(ruleName, config.ruleDescription || suggested.description)`
  - action `content` = `config.ruleMessage || suggested.message`
  - the duplicate-name pre-check probes `config.ruleName || suggested.name`
    (the name actually persisted), not the old `generateRuleName` form.
- `updateValidation` (numeric and date branches): same three substitutions.
  In particular the action content changes from `content: config.ruleMessage`
  (no fallback) to `content: config.ruleMessage || suggested.message`, matching
  the create path. The date branch's duplicate-name probe (currently
  `generateRuleName(...)`) also switches to `config.ruleName || suggested.name`.
  Compute `suggested` once near the top of `updateValidation` (it needs only
  `currentVariable`, `config`, `variables`).

### 3. Per-field default detection in `buildEditConfig`

Change the signature to receive `variables`:

```ts
buildEditConfig(parsed, rule, action, currentVariable, variables, programRulePrefix?)
```

Restructure so the **structural** config (operator + date/numeric bound fields)
is built first, then the texts are decided last:

```ts
const strippedName =
    programRulePrefix && rule.name.startsWith(`${programRulePrefix} - `)
        ? rule.name.substring(programRulePrefix.length + 3)
        : rule.name
const strippedDesc = removeAppSignature(rule.description || '')
const storedMessage = action.content || ''

const built = { /* operator + comparison/numeric fields, as today, no texts */ }
const suggested = getSuggestedRuleTexts(currentVariable, built, variables)

return {
    ...built,
    ruleName:        strippedName === suggested.name        ? undefined : strippedName,
    ruleDescription: strippedDesc === suggested.description ? undefined : strippedDesc,
    ruleMessage:     storedMessage === suggested.message    ? undefined : storedMessage,
}
```

A field left `undefined` reaches the form as `initialConfig?.ruleX ?? null` →
`null` → follows the live suggestion → regenerates as the bound changes. A field
that differs from the suggestion was customized → the stored value is preserved.
Detection is per-field, matching the approved granularity.

Comparison is like-for-like: name after prefix strip, description after
signature strip, message raw — each against the corresponding `suggested` field.

### 4. No form changes

`ValidationForm`'s `null`-means-follow-suggestion mechanism is unchanged; this
change simply lets edited rules opt back into it.

## Dead-code removal

All confirmed unused after the above (no legacy detection retained):

- `src/lib/builder.ts`: `generateRuleName`, `generateValidationMessage`
  (never called), `getValidationStageId` (never called), and the `difference_*`
  operator labels/branch (no `difference_*` operator exists anywhere in the app).
- `src/lib/validation.ts`: `generateDefaultDescription`,
  `generateDefaultNumericMessage`, `generateDefaultNumericDescription`.
- `src/services/rules.ts`: drop the corresponding imports.

## Call sites to update

- `src/pages/DetailsPage.tsx` — pass `variables` to `buildEditConfig`.
- `src/pages/RulesPage.tsx` — pass `variables` to both `buildEditConfig` calls.
  (`seedConfigFor`/`handleGroupEditSubmit` already force texts to `undefined`;
  behavior there is unchanged.)

## Tests

- `tests/validation.test.ts`: add `variables` arg to the 6 `buildEditConfig`
  calls; add cases proving (a) a still-default text becomes `undefined` and
  (b) a customized text is preserved, for both date and numeric; add a
  `getSuggestedRuleTexts` case.
- `tests/builder.test.ts`: remove tests for the deleted generators.
- `tests/services-rules.test.ts`: update any expected default rule names /
  messages to the unified ("X must be …") style, including the corrected
  "between" name that now carries both bounds.

## Out of scope

- Legacy metadata recognition (no existing installs).
- Any change to how conditions are built or to the form UI.

## Verification

- `pnpm test`, `pnpm run lint`, `pnpm exec tsc --noEmit` pass.
- Manual: create a bulk date rule (after 1900) → edit one element's bound to
  2000 → name/description/message all reflect 2000. Repeat after renaming the
  rule first → only the name is preserved; description/message still update.
