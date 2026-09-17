defineRouteMeta({
  openAPI: {
    tags: ['Authentication'],
    description: 'Start a login with a chosen provider. The user returns to `next` with a session token appended — exchange it at `/auth` for a JWT. Without `next` the token comes back as `{ key }`. Use `/auth` to let OAuth.ee ask which provider to use.',
    security: [], // The user is not authenticated yet — that is what this starts
    parameters: [
      {
        name: 'provider',
        in: 'path',
        required: true,
        schema: {
          type: 'string',
          enum: ['e-mail', 'google', 'apple', 'smart-id', 'mobile-id', 'id-card'],
          description: 'OAuth provider'
        }
      },
      {
        name: 'next',
        in: 'query',
        schema: {
          type: 'string',
          description: 'URL to return to, with the session token appended'
        }
      },
      {
        name: 'lang',
        in: 'query',
        schema: {
          type: 'string',
          enum: ['en', 'et'],
          description: 'OAuth.ee page language. Omit to let OAuth.ee choose'
        }
      }
    ],
    responses: {
      302: { description: 'Redirect to the OAuth.ee login' }
    }
  }
})

export default defineEventHandler((event) => oauthStartLogin(event, { provider: getRouterParam(event, 'provider') }))
