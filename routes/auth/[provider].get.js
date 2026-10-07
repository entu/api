defineRouteMeta({
  openAPI: {
    tags: ['Authentication'],
    description: 'Start a browser login with this provider, ending in a session token for `GET /auth`. See [OAuth](https://entu.ee/api/authentication/#oauth) and [Third-Party App Integration](https://entu.ee/api/authentication/#third-party-app-integration).',
    security: [], // The user is not authenticated yet — that is what this starts
    parameters: [
      {
        name: 'provider',
        in: 'path',
        required: true,
        schema: {
          type: 'string',
          enum: ['passkey', 'apple', 'google', 'e-mail', 'smart-id', 'mobile-id', 'id-card'],
          description: 'Login provider — any value other than `passkey` is passed on to OAuth.ee unvalidated'
        }
      },
      {
        name: 'next',
        in: 'query',
        schema: {
          type: 'string',
          description: 'Return URL, session token appended. Without it: JSON `{ key }`',
          example: 'https://your-app.com/auth?key='
        }
      },
      {
        name: 'lang',
        in: 'query',
        schema: {
          type: 'string',
          enum: ['en', 'et'],
          description: 'OAuth.ee page language'
        }
      }
    ],
    responses: {
      302: { description: 'To OAuth.ee or the Entu passkey page' }
    }
  }
})

export default defineEventHandler((event) => oauthStartLogin(event, { provider: getRouterParam(event, 'provider') }))
