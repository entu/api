import * as Sentry from '@sentry/node'

Sentry.init({
  dsn: process.env.NITRO_SENTRY_DSN,
  // Never report errors from local development
  enabled: process.env.NODE_ENV !== 'development',
  release: process.env.NITRO_COMMIT_HASH,
  tracesSampleRate: 0.1
})
