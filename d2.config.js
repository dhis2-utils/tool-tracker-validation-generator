/** @type {import('@dhis2/cli-app-scripts').D2Config} */
const config = {
    type: 'app',
    name: 'tracker-validation-tool',
    title: 'Tracker Validation Tool',
    description:
        'Configure and manage validation program rules (dates and numeric values) in DHIS2 tracker programmes',
    minDHIS2Version: '2.41',

    entryPoints: {
        app: './src/App.tsx',
    },

    viteConfigExtensions: './viteConfigExtensions.mts',
}

module.exports = config
