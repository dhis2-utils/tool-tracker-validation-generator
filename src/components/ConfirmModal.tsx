import i18n from '@dhis2/d2-i18n'
import {
    Button,
    ButtonStrip,
    Modal,
    ModalActions,
    ModalContent,
    ModalTitle,
} from '@dhis2/ui'
import { ReactNode } from 'react'

export const ConfirmModal = ({
    title,
    children,
    confirmLabel,
    destructive = false,
    busy = false,
    onConfirm,
    onCancel,
}: {
    title: string
    children: ReactNode
    confirmLabel: string
    destructive?: boolean
    busy?: boolean
    onConfirm: () => void
    onCancel: () => void
}) => (
    <Modal position="middle" small onClose={onCancel}>
        <ModalTitle>{title}</ModalTitle>
        <ModalContent>{children}</ModalContent>
        <ModalActions>
            <ButtonStrip end>
                <Button secondary onClick={onCancel} disabled={busy}>
                    {i18n.t('Cancel')}
                </Button>
                <Button
                    primary={!destructive}
                    destructive={destructive}
                    onClick={onConfirm}
                    loading={busy}
                >
                    {confirmLabel}
                </Button>
            </ButtonStrip>
        </ModalActions>
    </Modal>
)
