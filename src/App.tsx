import './locales'
import { CssReset, CssVariables } from '@dhis2/ui'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createHashRouter, RouterProvider } from 'react-router-dom'
import { AppShell } from '@/components/AppShell'
import { DetailsPage } from '@/pages/DetailsPage'
import { OverviewPage } from '@/pages/OverviewPage'
import { RulesPage } from '@/pages/RulesPage'
import { SelectProgramPage } from '@/pages/SelectProgramPage'
import { SyncUrlWithGlobalShell } from '@/utils/SyncUrlWithGlobalShell'

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            retry: 1,
            refetchOnWindowFocus: false,
        },
    },
})

const router = createHashRouter([
    {
        element: <SyncUrlWithGlobalShell />,
        children: [
            {
                element: <AppShell />,
                children: [
                    { path: '/', element: <SelectProgramPage /> },
                    { path: '/:programId', element: <OverviewPage /> },
                    { path: '/:programId/rules', element: <RulesPage /> },
                    {
                        path: '/:programId/variable/:type/:id/:stageId?',
                        element: <DetailsPage />,
                    },
                ],
            },
        ],
    },
])

const App = () => (
    <QueryClientProvider client={queryClient}>
        <CssReset />
        <CssVariables theme spacers colors elevations />
        <RouterProvider router={router} />
    </QueryClientProvider>
)

export default App
