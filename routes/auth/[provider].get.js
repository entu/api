defineRouteMeta({
  openAPI: {
    tags: ['Authentication'],
    description: 'Start a login with a chosen provider. Redirects to the OAuth.ee login for that provider; OAuth.ee returns the user to `/auth`, which completes the login and hands back a temporary session token. Use `/auth` without a provider to let OAuth.ee ask which one to use.',
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
          description: 'URL to redirect to after successful authentication — the session token is appended to it'
        }
      },
      {
        name: 'lang',
        in: 'query',
        schema: {
          type: 'string',
          enum: ['en', 'et'],
          description: 'Language for the OAuth.ee login page. Omit to let OAuth.ee choose'
        }
      }
    ],
    responses: {
      302: { description: 'Redirect to the OAuth.ee login' }
    }
  }
})

export default defineEventHandler((event) => oauthStartLogin(event, { provider: getRouterParam(event, 'provider') }))
