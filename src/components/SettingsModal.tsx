import i18n from '@dhis2/d2-i18n'
import {
    Button,
    ButtonStrip,
    CircularLoader,
    InputField,
    Modal,
    ModalActions,
    ModalContent,
    ModalTitle,
} from '@dhis2/ui'
import { useEffect, useState } from 'react'
import {
    useProgramConfig,
    useSaveProgramConfig,
} from '@/hooks/useProgramConfig'
import { sanitizePrvPrefix } from '@/lib/variables'

export const SettingsModal = ({
    programId,
    onClose,
}: {
    programId: string
    onClose: () => void
}) => {
    const { config, isLoading } = useProgramConfig(programId)
    const { saveConfig, isSaving } = useSaveProgramConfig(programId)
    const [rulePrefix, setRulePrefix] = useState('')
    const [variablePrefix, setVariablePrefix] = useState('')

    useEffect(() => {
        if (config) {
            setRulePrefix(config.programRulePrefix || '')
            setVariablePrefix(config.programRuleVariablePrefix || '')
        }
    }, [config])

    const handleSave = () => {
        saveConfig(
            {
                programRulePrefix: rulePrefix,
                programRuleVariablePrefix: sanitizePrvPrefix(variablePrefix),
            },
            { onSuccess: onClose }
        )
    }

    return (
        <Modal position="middle" onClose={onClose}>
            <ModalTitle>{i18n.t('Programme settings')}</ModalTitle>
            <ModalContent>
                {isLoading ? (
                    <CircularLoader small />
                ) : (
                    <>
                        <InputField
                            label={i18n.t('Program rule name prefix')}
                            placeholder={i18n.t('e.g. EIR')}
                            helpText={i18n.t(
                                'Added to all program rule names created by this tool'
                            )}
                            value={rulePrefix}
                            onChange={({ value }: { value?: string }) =>
                                setRulePrefix(value ?? '')
                            }
                        />
                        <InputField
                            label={i18n.t('Program rule variable prefix')}
                            placeholder={i18n.t('e.g. EIR')}
                            helpText={
                                sanitizePrvPrefix(variablePrefix) !==
                                variablePrefix
                                    ? i18n.t('Will be saved as "{{prefix}}"', {
                                          prefix: sanitizePrvPrefix(
                                              variablePrefix
                                          ),
                                          nsSeparator: undefined,
                                      })
                                    : i18n.t(
                                          'Added to all program rule variable names (letters, digits and underscores)'
                                      )
                            }
                            value={variablePrefix}
                            onChange={({ value }: { value?: string }) =>
                                setVariablePrefix(value ?? '')
                            }
                        />
                    </>
                )}
            </ModalContent>
            <ModalActions>
                <ButtonStrip end>
                    <Button secondary onClick={onClose} disabled={isSaving}>
                        {i18n.t('Cancel')}
                    </Button>
                    <Button primary onClick={handleSave} loading={isSaving}>
                        {i18n.t('Save settings')}
                    </Button>
                </ButtonStrip>
            </ModalActions>
        </Modal>
    )
}
