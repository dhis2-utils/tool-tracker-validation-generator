import i18n from '@dhis2/d2-i18n'
import { NoticeBox } from '@dhis2/ui'

export const SelectProgramPage = () => (
    <NoticeBox title={i18n.t('Select a programme')}>
        {i18n.t(
            'Choose a tracker programme in the bar above to view its date and numeric variables and manage validation rules.'
        )}
    </NoticeBox>
)
