import i18n from '@dhis2/d2-i18n'
import {
    Button,
    ButtonStrip,
    Card,
    InputField,
    SingleSelectField,
    SingleSelectOption,
    Tag,
} from '@dhis2/ui'
import { useEffect, useState } from 'react'
import styles from './BatchWorkspace.module.css'
import { useBatchQueue } from '@/components/BatchQueueContext'
import { useFeedback } from '@/hooks/useFeedback'
import type {
    BatchScope,
    BatchTemplate,
    ProgramMetadata,
    RelativeDirection,
    Variable,
    VariableCategory,
} from '@/lib/types'
import {
    createBatchTemplateKey,
    getBatchTemplateSummary,
    getUnvalidatedVariables,
} from '@/lib/validation'
import type { BatchProgress, ProgramConfig } from '@/services/rules'

const ACTION_TYPE_OPTIONS = [
    { value: 'SHOWERROR', label: () => i18n.t('Error — block save') },
    { value: 'SHOWWARNING', label: () => i18n.t('Warning — allow save') },
    { value: 'ERRORONCOMPLETE', label: () => i18n.t('Error on complete') },
    { value: 'WARNINGONCOMPLETE', label: () => i18n.t('Warning on complete') },
]

interface BatchWorkspaceProps {
    programMetadata: ProgramMetadata
    variables: Variable[]
    config: ProgramConfig | null
    applyBatch: (input: {
        templates: BatchTemplate[]
        getTargets: (template: BatchTemplate) => Variable[]
    }) => Promise<unknown>
    isApplyingBatch: boolean
    batchProgress: BatchProgress | null
}

export const BatchWorkspace = ({
    programMetadata,
    variables,
    config,
    applyBatch,
    isApplyingBatch,
    batchProgress,
}: BatchWorkspaceProps) => {
    const { templates, setTemplates } = useBatchQueue()
    const { showSuccess, showError } = useFeedback()

    const [category, setCategory] = useState<VariableCategory>('date')
    const [scope, setScope] = useState<BatchScope>('programme')
    const [stageId, setStageId] = useState<string | undefined>(undefined)
    const [actionType, setActionType] = useState('SHOWERROR')
    // date template fields
    const [operator, setOperator] = useState<string | undefined>(undefined)
    const [comparisonDateMode, setComparisonDateMode] = useState<
        'fixed' | 'current' | 'relative'
    >('fixed')
    const [fixedDate, setFixedDate] = useState('')
    const [relativeAmount, setRelativeAmount] = useState('')
    const [relativeUnit, setRelativeUnit] = useState('years')
    const [relativeDirection, setRelativeDirection] =
        useState<RelativeDirection>('past')
    const [intervalAmount, setIntervalAmount] = useState('')
    const [intervalUnit, setIntervalUnit] = useState('days')
    // numeric template fields
    const [numericOperator, setNumericOperator] = useState<string | undefined>(
        undefined
    )
    const [numericValue, setNumericValue] = useState('')

    // The overview stays mounted when the header switches programme — a
    // stage picked for the previous programme must not leak into this one.
    useEffect(() => {
        setStageId(undefined)
    }, [programMetadata.id])

    const stageExists = (programMetadata.programStages || []).some(
        (stage) => stage.id === stageId
    )

    const isInterval =
        operator === 'within_before' || operator === 'within_after'

    const collectTemplate = (): BatchTemplate | null => {
        if (scope === 'stage' && (!stageId || !stageExists)) {
            return null
        }
        if (category === 'numeric') {
            if (!numericOperator || numericValue === '') {
                return null
            }
            return {
                category,
                scope,
                stageId: scope === 'stage' ? stageId : null,
                actionType,
                numericOperator,
                numericComparisonType: 'value',
                numericValue: parseFloat(numericValue),
            }
        }
        if (!operator) {
            return null
        }
        if (isInterval && !intervalAmount) {
            return null
        }
        if (comparisonDateMode === 'fixed' && !fixedDate) {
            return null
        }
        if (comparisonDateMode === 'relative' && !relativeAmount) {
            return null
        }
        return {
            category,
            scope,
            stageId: scope === 'stage' ? stageId : null,
            actionType,
            operator,
            comparisonDateMode,
            comparisonDate: '',
            fixedComparisonDate:
                comparisonDateMode === 'fixed' ? fixedDate : '',
            relativeComparisonAmount:
                comparisonDateMode === 'relative'
                    ? parseInt(relativeAmount, 10)
                    : null,
            relativeComparisonUnit: relativeUnit,
            relativeComparisonDirection: relativeDirection,
            intervalAmount: intervalAmount
                ? parseInt(intervalAmount, 10)
                : null,
            intervalUnit,
        }
    }

    const draftTemplate = collectTemplate()

    const addTemplate = () => {
        if (!config?.programRuleVariablePrefix?.trim()) {
            showError(
                i18n.t('Configure programme settings before adding bulk rules.')
            )
            return
        }
        if (scope === 'stage' && (!stageId || !stageExists)) {
            showError(i18n.t('Choose a programme stage for this bulk rule.'))
            return
        }
        const template = collectTemplate()
        if (!template) {
            showError(
                i18n.t('Complete the bulk rule before adding it to the queue.')
            )
            return
        }
        const signature = createBatchTemplateKey(template)
        if (
            templates.some(
                (existing) => createBatchTemplateKey(existing) === signature
            )
        ) {
            showError(i18n.t('That bulk rule is already queued.'))
            return
        }
        setTemplates([...templates, template])
        showSuccess(i18n.t('Bulk rule added to the queue.'))
    }

    const removeTemplate = (index: number) => {
        setTemplates(templates.filter((_, i) => i !== index))
    }

    const handleApply = async () => {
        if (templates.length === 0 || isApplyingBatch) {
            return
        }
        try {
            await applyBatch({
                templates,
                getTargets: (template) =>
                    getUnvalidatedVariables(
                        programMetadata,
                        variables,
                        template.category,
                        template.scope === 'stage'
                            ? (template.stageId ?? null)
                            : null
                    ),
            })
            setTemplates([])
        } catch {
            // error alert already shown by the mutation hook
        }
    }

    const stageNameById = new Map(
        (programMetadata.programStages || []).map((stage) => [
            stage.id,
            stage.name,
        ])
    )

    return (
        <Card>
            <div className={styles.cardHeader}>
                <h3>{i18n.t('Bulk rules for unvalidated variables')}</h3>
            </div>
            <div className={styles.cardBody}>
                <p className={styles.helperText}>
                    {i18n.t(
                        'Queue reusable baseline rules here, then apply all queued rules in one go to variables that currently have no validations.'
                    )}
                </p>

                <div className={styles.templateGrid}>
                    <SingleSelectField
                        dense
                        label={i18n.t('Variable type')}
                        selected={category}
                        onChange={({ selected }: { selected: string }) =>
                            setCategory(selected as VariableCategory)
                        }
                    >
                        <SingleSelectOption
                            value="date"
                            label={i18n.t('Date')}
                        />
                        <SingleSelectOption
                            value="numeric"
                            label={i18n.t('Numeric')}
                        />
                    </SingleSelectField>
                    <SingleSelectField
                        dense
                        label={i18n.t('Apply within')}
                        selected={scope}
                        onChange={({ selected }: { selected: string }) =>
                            setScope(selected as BatchScope)
                        }
                    >
                        <SingleSelectOption
                            value="programme"
                            label={i18n.t('Whole programme')}
                        />
                        <SingleSelectOption
                            value="stage"
                            label={i18n.t('One programme stage')}
                        />
                    </SingleSelectField>
                    {scope === 'stage' && (
                        <SingleSelectField
                            dense
                            label={i18n.t('Programme stage')}
                            placeholder={i18n.t('Choose stage...')}
                            selected={stageExists ? stageId : undefined}
                            onChange={({ selected }: { selected: string }) =>
                                setStageId(selected)
                            }
                        >
                            {(programMetadata.programStages || []).map(
                                (stage) => (
                                    <SingleSelectOption
                                        key={stage.id}
                                        value={stage.id}
                                        label={stage.name}
                                    />
                                )
                            )}
                        </SingleSelectField>
                    )}
                </div>

                {category === 'date' ? (
                    <div className={styles.ruleBuilder}>
                        <span className={styles.varName}>
                            {i18n.t('Any unvalidated date')}
                        </span>
                        <span className={styles.connector}>
                            {i18n.t('should be')}
                        </span>
                        <SingleSelectField
                            dense
                            className={styles.inlineSelect}
                            placeholder={i18n.t('Choose relationship...')}
                            selected={operator}
                            onChange={({ selected }: { selected: string }) =>
                                setOperator(selected)
                            }
                        >
                            <SingleSelectOption
                                value="before"
                                label={i18n.t('before')}
                            />
                            <SingleSelectOption
                                value="after"
                                label={i18n.t('after')}
                            />
                            <SingleSelectOption
                                value="on_or_after"
                                label={i18n.t('on or after')}
                            />
                            <SingleSelectOption
                                value="on_or_before"
                                label={i18n.t('on or before')}
                            />
                            <SingleSelectOption
                                value="within_before"
                                label={i18n.t('within ... before')}
                            />
                            <SingleSelectOption
                                value="within_after"
                                label={i18n.t('within ... after')}
                            />
                        </SingleSelectField>
                        {isInterval && (
                            <>
                                <InputField
                                    dense
                                    className={styles.inlineNumber}
                                    type="number"
                                    min="1"
                                    placeholder="30"
                                    value={intervalAmount}
                                    onChange={({ value }: { value?: string }) =>
                                        setIntervalAmount(value ?? '')
                                    }
                                />
                                <SingleSelectField
                                    dense
                                    className={styles.inlineUnit}
                                    selected={intervalUnit}
                                    onChange={({
                                        selected,
                                    }: {
                                        selected: string
                                    }) => setIntervalUnit(selected)}
                                >
                                    <SingleSelectOption
                                        value="days"
                                        label={i18n.t('days')}
                                    />
                                    <SingleSelectOption
                                        value="weeks"
                                        label={i18n.t('weeks')}
                                    />
                                    <SingleSelectOption
                                        value="months"
                                        label={i18n.t('months')}
                                    />
                                    <SingleSelectOption
                                        value="years"
                                        label={i18n.t('years')}
                                    />
                                </SingleSelectField>
                                <span className={styles.connector}>
                                    {operator === 'within_before'
                                        ? i18n.t('before')
                                        : i18n.t('after')}
                                </span>
                            </>
                        )}
                        <SingleSelectField
                            dense
                            className={styles.inlineSelect}
                            selected={comparisonDateMode}
                            onChange={({ selected }: { selected: string }) =>
                                setComparisonDateMode(
                                    selected as 'fixed' | 'current' | 'relative'
                                )
                            }
                        >
                            <SingleSelectOption
                                value="fixed"
                                label={i18n.t('a fixed date')}
                            />
                            <SingleSelectOption
                                value="current"
                                label={i18n.t('the current date')}
                            />
                            <SingleSelectOption
                                value="relative"
                                label={i18n.t('relative to the current date')}
                            />
                        </SingleSelectField>
                        {comparisonDateMode === 'fixed' && (
                            <InputField
                                dense
                                className={styles.inlineDate}
                                type="date"
                                value={fixedDate}
                                onChange={({ value }: { value?: string }) =>
                                    setFixedDate(value ?? '')
                                }
                            />
                        )}
                        {comparisonDateMode === 'relative' && (
                            <>
                                <span className={styles.connector}>
                                    {i18n.t('offset by')}
                                </span>
                                <InputField
                                    dense
                                    className={styles.inlineNumber}
                                    type="number"
                                    min="1"
                                    placeholder="1"
                                    value={relativeAmount}
                                    onChange={({ value }: { value?: string }) =>
                                        setRelativeAmount(value ?? '')
                                    }
                                />
                                <SingleSelectField
                                    dense
                                    className={styles.inlineUnit}
                                    selected={relativeUnit}
                                    onChange={({
                                        selected,
                                    }: {
                                        selected: string
                                    }) => setRelativeUnit(selected)}
                                >
                                    <SingleSelectOption
                                        value="days"
                                        label={i18n.t('days')}
                                    />
                                    <SingleSelectOption
                                        value="months"
                                        label={i18n.t('months')}
                                    />
                                    <SingleSelectOption
                                        value="years"
                                        label={i18n.t('years')}
                                    />
                                </SingleSelectField>
                                <SingleSelectField
                                    dense
                                    className={styles.inlineUnit}
                                    selected={relativeDirection}
                                    onChange={({
                                        selected,
                                    }: {
                                        selected: string
                                    }) =>
                                        setRelativeDirection(
                                            selected as RelativeDirection
                                        )
                                    }
                                >
                                    <SingleSelectOption
                                        value="past"
                                        label={i18n.t('in the past')}
                                    />
                                    <SingleSelectOption
                                        value="future"
                                        label={i18n.t('in the future')}
                                    />
                                </SingleSelectField>
                            </>
                        )}
                    </div>
                ) : (
                    <div className={styles.ruleBuilder}>
                        <span className={styles.varName}>
                            {i18n.t('Any unvalidated number')}
                        </span>
                        <span className={styles.connector}>
                            {i18n.t('should be')}
                        </span>
                        <SingleSelectField
                            dense
                            className={styles.inlineSelect}
                            placeholder={i18n.t('Choose operator...')}
                            selected={numericOperator}
                            onChange={({ selected }: { selected: string }) =>
                                setNumericOperator(selected)
                            }
                        >
                            <SingleSelectOption
                                value="less_than"
                                label={i18n.t('less than')}
                            />
                            <SingleSelectOption
                                value="less_than_or_equal"
                                label={i18n.t('less than or equal to')}
                            />
                            <SingleSelectOption
                                value="greater_than"
                                label={i18n.t('greater than')}
                            />
                            <SingleSelectOption
                                value="greater_than_or_equal"
                                label={i18n.t('greater than or equal to')}
                            />
                            <SingleSelectOption
                                value="equal_to"
                                label={i18n.t('equal to')}
                            />
                            <SingleSelectOption
                                value="not_equal_to"
                                label={i18n.t('not equal to')}
                            />
                        </SingleSelectField>
                        <span className={styles.connector}>
                            {i18n.t('a fixed value of')}
                        </span>
                        <InputField
                            dense
                            className={styles.inlineNumber}
                            type="number"
                            step="0.01"
                            value={numericValue}
                            onChange={({ value }: { value?: string }) =>
                                setNumericValue(value ?? '')
                            }
                        />
                    </div>
                )}

                <div className={styles.actionTypeRow}>
                    <SingleSelectField
                        dense
                        label={i18n.t('Action type')}
                        selected={actionType}
                        onChange={({ selected }: { selected: string }) =>
                            setActionType(selected)
                        }
                    >
                        {ACTION_TYPE_OPTIONS.map((option) => (
                            <SingleSelectOption
                                key={option.value}
                                value={option.value}
                                label={option.label()}
                            />
                        ))}
                    </SingleSelectField>
                </div>

                <div className={styles.previewPanel}>
                    <span className={styles.previewLabel}>
                        {i18n.t('Template preview')}
                    </span>
                    <span>
                        {draftTemplate
                            ? getBatchTemplateSummary(draftTemplate)
                            : i18n.t(
                                  'Configure a bulk rule template to preview it here.'
                              )}
                    </span>
                </div>

                <ButtonStrip>
                    <Button secondary small onClick={addTemplate}>
                        {i18n.t('Add to bulk queue')}
                    </Button>
                </ButtonStrip>

                <div className={styles.drafts}>
                    {templates.length === 0 ? (
                        <p className={styles.emptyState}>
                            {i18n.t('No queued bulk rules yet.')}
                        </p>
                    ) : (
                        templates.map((template, index) => (
                            <div
                                key={createBatchTemplateKey(template)}
                                className={styles.draftCard}
                            >
                                <div className={styles.draftHeader}>
                                    <strong>
                                        {getBatchTemplateSummary(template)}
                                    </strong>
                                    <Button
                                        small
                                        secondary
                                        onClick={() => removeTemplate(index)}
                                        disabled={isApplyingBatch}
                                    >
                                        {i18n.t('Remove')}
                                    </Button>
                                </div>
                                <p className={styles.draftDescription}>
                                    {i18n.t(
                                        'These rules are applied only to variables that are currently unvalidated when you click Apply queued rules.'
                                    )}
                                </p>
                                <div className={styles.draftMeta}>
                                    <Tag
                                        neutral={
                                            template.category !== 'numeric'
                                        }
                                    >
                                        {template.category === 'numeric'
                                            ? i18n.t('Numeric')
                                            : i18n.t('Date')}
                                    </Tag>
                                    <Tag>
                                        {template.scope === 'stage'
                                            ? i18n.t('Stage: {{name}}', {
                                                  name:
                                                      stageNameById.get(
                                                          template.stageId ?? ''
                                                      ) ||
                                                      i18n.t('Unknown stage'),
                                                  nsSeparator: undefined,
                                              })
                                            : i18n.t('Whole programme')}
                                    </Tag>
                                    <Tag>{String(template.actionType)}</Tag>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                <ButtonStrip>
                    <Button
                        primary
                        small
                        disabled={templates.length === 0 || isApplyingBatch}
                        loading={isApplyingBatch}
                        onClick={handleApply}
                    >
                        {isApplyingBatch && batchProgress
                            ? i18n.t(
                                  'Applying queued rules... {{completed}}/{{total}}',
                                  {
                                      completed: batchProgress.completed,
                                      total: batchProgress.total,
                                      nsSeparator: undefined,
                                  }
                              )
                            : i18n.t('Apply queued rules')}
                    </Button>
                    <Button
                        small
                        secondary
                        disabled={templates.length === 0 || isApplyingBatch}
                        onClick={() => setTemplates([])}
                    >
                        {i18n.t('Clear queue')}
                    </Button>
                </ButtonStrip>
                <span aria-live="polite" className={styles.applyStatus}>
                    {isApplyingBatch && batchProgress
                        ? i18n.t(
                              'Applying {{completed}} of {{total}} queued rule templates...',
                              {
                                  completed: batchProgress.completed,
                                  total: batchProgress.total,
                                  nsSeparator: undefined,
                              }
                          )
                        : ''}
                </span>
            </div>
        </Card>
    )
}
