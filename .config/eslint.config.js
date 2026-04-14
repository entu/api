import stylistic from '@stylistic/eslint-plugin'
import unicorn from 'eslint-plugin-unicorn'

export default [
  {
    ignores: ['.nitro/', '.output/']
  },
  {
    plugins: {
      '@stylistic': stylistic,
      unicorn
    },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        // Node.js
        Buffer: 'readonly',
        console: 'readonly',
        process: 'readonly',
        // Nitro auto-imports
        $fetch: 'readonly',
        createError: 'readonly',
        defineEventHandler: 'readonly',
        defineNitroPlugin: 'readonly',
        defineRouteMeta: 'readonly',
        getQuery: 'readonly',
        getRequestIP: 'readonly',
        getRequestURL: 'readonly',
        getRouterParam: 'readonly',
        redirect: 'readonly',
        useRuntimeConfig: 'readonly',
        useStorage: 'readonly',
        // Auto-imported from utils/
        addAggregateQueue: 'readonly',
        aggregateEntity: 'readonly',
        buildEntuContext: 'readonly',
        buildMongoFilter: 'readonly',
        buildResolvers: 'readonly',
        cleanupEntity: 'readonly',
        combineRights: 'readonly',
        connectDb: 'readonly',
        formatDatabaseName: 'readonly',
        formula: 'readonly',
        getAccessArray: 'readonly',
        getObjectId: 'readonly',
        getOrBuildSchema: 'readonly',
        getParentRights: 'readonly',
        getSignedDownloadUrl: 'readonly',
        getSignedUploadUrl: 'readonly',
        getValueArray: 'readonly',
        initializeNewDatabase: 'readonly',
        isAvailableDatabase: 'readonly',
        logger: 'readonly',
        loggerError: 'readonly',
        mongoDbSystemDbs: 'readonly',
        sendInviteEmail: 'readonly',
        setEntity: 'readonly',
        toGqlFieldName: 'readonly',
        toGqlTypeName: 'readonly',
        triggerWebhooks: 'readonly',
        uniqBy: 'readonly'
      }
    },
    rules: {
      '@stylistic/arrow-parens': ['error', 'always'],
      '@stylistic/brace-style': ['error', 'stroustrup'],
      '@stylistic/comma-dangle': ['error', 'never'],
      '@stylistic/indent': ['error', 2],
      '@stylistic/quote-props': ['error', 'as-needed'],
      '@stylistic/quotes': ['error', 'single'],
      '@stylistic/semi': ['error', 'never'],
      '@stylistic/space-before-function-paren': ['error', 'always'],
      'unicorn/no-array-for-each': 'error',
      'unicorn/no-useless-undefined': 'error',
      'unicorn/prefer-at': 'error',
      'unicorn/prefer-date-now': 'error',
      'unicorn/prefer-number-properties': 'error',
      'unicorn/prefer-string-slice': 'error'
    }
  }
]
