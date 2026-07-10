import config from '@dhis2/config-eslint'
import { includeIgnoreFile } from '@eslint/compat'
import { defineConfig } from 'eslint/config'
import { fileURLToPath } from 'node:url'

const gitignorePath = fileURLToPath(new URL('.gitignore', import.meta.url))

export default defineConfig([
    includeIgnoreFile(gitignorePath, 'Imported .gitignore patterns'),
    {
        extends: [config],
        settings: {
            // Resolve named exports from packages that ship exports-map or
            // types-only entry points (react-router-dom, @tanstack/react-query,
            // @dhis2/ui icons) — the default node resolver can't read them.
            'import/resolver': {
                typescript: {
                    alwaysTryTypes: true,
                },
            },
        },
        rules: {
            // The rule-builder domain functions (ported from the original
            // tool, covered by unit tests) legitimately take several
            // positional arguments.
            'max-params': 'off',
        },
    },
])
