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
      // Guard clauses stay inline and brace-less (`if (x) return` /
      // `continue` / `break` — value-less only); every other if/else/loop
      // body, including `return <value>`, must be a multiline braced
      // block. Enforced by three rules together:
      // - curly multi-line: anything spanning lines needs braces
      // - nonblock-statement-body-position: a brace-less body sits on the
      //   same line as its `if`
      // - no-restricted-syntax: brace-less bodies may only be a bare
      //   return/continue/break, and a block holding ONLY a bare
      //   return/continue/break must be inlined instead
      curly: ['error', 'multi-line'],
      '@stylistic/nonblock-statement-body-position': ['error', 'beside'],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'IfStatement > .consequent:not(BlockStatement, ReturnStatement, ContinueStatement, BreakStatement)',
          message: 'Only a bare return/continue/break may follow an if without braces — use a block.'
        },
        {
          selector: 'IfStatement > ReturnStatement.consequent[argument]',
          message: 'return with a value goes in a braced block — only a bare `if (x) return` stays inline.'
        },
        {
          selector: 'IfStatement > .alternate:not(BlockStatement, IfStatement)',
          message: 'An else body must be a braced block.'
        },
        {
          selector: ':matches(ForStatement, ForInStatement, ForOfStatement, WhileStatement, DoWhileStatement) > .body:not(BlockStatement)',
          message: 'A loop body must be a braced block.'
        },
        {
          selector: 'IfStatement[alternate=null] > BlockStatement.consequent[body.length=1] > ReturnStatement[argument=null]',
          message: 'A guard that only returns goes inline without braces: `if (x) return`.'
        },
        {
          selector: 'IfStatement[alternate=null] > BlockStatement.consequent[body.length=1] > ContinueStatement',
          message: '`if (x) continue` goes inline without braces.'
        },
        {
          selector: 'IfStatement[alternate=null] > BlockStatement.consequent[body.length=1] > BreakStatement',
          message: '`if (x) break` goes inline without braces.'
        }
      ],
      '@stylistic/arrow-parens': ['error', 'always'],
      '@stylistic/brace-style': ['error', 'stroustrup'],
      '@stylistic/comma-dangle': ['error', 'never'],
      '@stylistic/eol-last': 'error',
      '@stylistic/indent': ['error', 2],
      '@stylistic/no-multi-spaces': 'error',
      '@stylistic/no-multiple-empty-lines': ['error', { max: 1 }],
      '@stylistic/no-trailing-spaces': 'error',
      '@stylistic/object-curly-spacing': ['error', 'always'],
      '@stylistic/quote-props': ['error', 'as-needed'],
      '@stylistic/quotes': ['error', 'single'],
      '@stylistic/semi': ['error', 'never'],
      '@stylistic/space-before-function-paren': ['error', 'always'],
      'unicorn/no-array-for-each': 'error',
      'unicorn/no-lonely-if': 'error',
      'unicorn/no-useless-undefined': 'error',
      'unicorn/prefer-array-flat-map': 'error',
      'unicorn/prefer-at': 'error',
      'unicorn/prefer-date-now': 'error',
      'unicorn/prefer-includes': 'error',
      'unicorn/prefer-number-properties': 'error',
      'unicorn/prefer-string-slice': 'error'
    }
  }
]
