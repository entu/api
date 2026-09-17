defineRouteMeta({
  openAPI: {
    tags: ['Authentication'],
    description: 'Start OAuth flow via OAuth.ee. Redirects to provider login, exchanges authorization code for user profile, matches or creates person entity, and redirects back with a temporary session token. Exchange it at `/auth` for a JWT.',
    security: [], // No authentication required for OAuth callback
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
          description: 'URL to redirect to after successful authentication'
        }
      },
      {
        name: 'lang',
        in: 'query',
        schema: {
          type: 'string',
          enum: ['en', 'et'],
          description: 'Language for the OAuth.ee login page'
        }
      },
      {
        name: 'code',
        in: 'query',
        schema: {
          type: 'string',
          description: 'OAuth authorization code from provider'
        }
      },
      {
        name: 'error',
        in: 'query',
        schema: {
          type: 'string',
          description: 'OAuth error message if authentication failed'
        }
      },
      {
        name: 'state',
        in: 'query',
        schema: {
          type: 'string',
          description: 'OAuth state parameter for CSRF protection'
        }
      }
    ],
    responses: {
      200: {
        description: 'Temporary session token (when `next` is not set)',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                key: { type: 'string', description: 'Session token — exchange at `/auth` for JWT', example: 'M2s8xKpwxG77JYxbx7xw4cS9' }
              }
            }
          }
        }
      },
      302: {
        description: 'Redirect to `next` URL with session token appended, or redirect to OAuth provider'
      },
      400: {
        description: 'OAuth error from provider',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      }
    }
  }
})

export default defineEventHandler(async (event) => {
  const { code, error, state } = getQuery(event)

  if (error) {
    throw createError({
      statusCode: 400,
      statusMessage: error
    })
  }

  if (code && state) {
    return await oauthCompleteLogin(event, code, state)
  }

  return oauthStartLogin(event, getRouterParam(event, 'provider'))
})
