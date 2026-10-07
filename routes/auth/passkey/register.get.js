defineRouteMeta({
  openAPI: {
    tags: ['Authentication'],
    description: 'Start a browser login that creates a new passkey, ending in a session token for `GET /auth` like any `/auth/{provider}`. See [OAuth](https://entu.ee/api/authentication/#oauth).',
    security: [], // The user is not authenticated yet — that is what this starts
    parameters: [
      {
        name: 'next',
        in: 'query',
        schema: {
          type: 'string',
          description: 'Return URL, session token appended. Without it: JSON `{ key }`',
          example: 'https://your-app.com/auth?key='
        }
      }
    ],
    responses: {
      302: { description: 'To the Entu passkey page' }
    }
  }
})

export default defineEventHandler((event) => oauthStartLogin(event, { provider: 'passkey', register: true }))
