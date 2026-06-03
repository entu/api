import * as Sentry from '@sentry/node'

Sentry.init({
  dsn: process.env.NITRO_SENTRY_DSN,
  release: process.env.NITRO_COMMIT_HASH
})
