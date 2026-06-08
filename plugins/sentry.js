import * as Sentry from '@sentry/node'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('error', (error, { event }) => {
    // Skip client errors (4xx) — only report unexpected server errors
    if (error.statusCode && error.statusCode < 500) return

    Sentry.captureException(error, {
      extra: {
        path: event?.path,
        method: event?.method
      }
    })
  })
})
