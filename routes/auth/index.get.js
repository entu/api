defineRouteMeta({
  openAPI: {
    tags: ['Authentication'],
    description: 'Exchange an API key or a session token for a 12-hour JWT, with the databases that identity can reach. Use `db` to limit it to one.\n\nWithout an `Authorization` header it starts a login instead, letting OAuth.ee ask which provider to use. Passkey sign-in has its own endpoint and does not come through here.',
    security: [], // Uses API key, not JWT
    parameters: [
      {
        name: 'authorization',
        in: 'header',
        schema: {
          type: 'string',
          description: 'API key, or the session token from a login. Omit to start a login',
          example: 'Bearer nEkPYET5fYjJqktNz9yfLxPF'
        }
      },
      {
        name: 'db',
        in: 'query',
        schema: {
          type: 'string',
          description: 'Limit auth to this database'
        }
      },
      {
        name: 'account',
        in: 'query',
        schema: {
          type: 'string',
          description: 'Alias for `db`'
        }
      },
      {
        name: 'invite',
        in: 'query',
        schema: {
          type: 'string',
          description: 'Invite token to accept while authenticating'
        }
      },
      {
        name: 'next',
        in: 'query',
        schema: {
          type: 'string',
          description: 'Starting a login: URL to return to, with the session token appended'
        }
      },
      {
        name: 'lang',
        in: 'query',
        schema: {
          type: 'string',
          enum: ['en', 'et'],
          description: 'Starting a login: OAuth.ee page language. Omit to let OAuth.ee choose'
        }
      }
    ],
    responses: {
      200: {
        description: 'JWT token with accessible accounts',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                accounts: {
                  type: 'array',
                  description: 'Databases the user has access to',
                  items: {
                    type: 'object',
                    properties: {
                      _id: { type: 'string', example: 'mydatabase' },
                      name: { type: 'string', example: 'mydatabase' },
                      user: {
                        type: 'object',
                        properties: {
                          _id: { type: 'string', example: 'npfwb8fv4ku7tzpq5yjarncc' },
                          name: { type: 'string', example: 'User 1' }
                        }
                      }
                    }
                  }
                },
                user: {
                  type: 'object',
                  properties: {
                    uid: { type: 'string', description: 'OAuth provider user ID — absent for API key auth' },
                    provider: { type: 'string', description: 'OAuth provider name — absent for API key auth' },
                    email: { type: 'string' },
                    name: { type: 'string' }
                  }
                },
                token: { type: 'string', description: '12-hour JWT' },
                expires: { type: 'string', format: 'date-time', description: 'Token expiry as ISO 8601 datetime' },
                conflict: { type: 'string', description: 'Set to `invite` if invite targets an entity already linked to another user' }
              }
            }
          }
        }
      },
      302: { description: 'Redirect to the OAuth.ee login, when called without an Authorization header' },
      400: {
        description: 'Invalid session, missing user email, or an error reported by the provider',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      },
      401: {
        description: 'Credential is not valid, or grants access to no database',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      }
    }
  }
})

export default defineEventHandler(async (event) => {
  const key = (event.req.headers.get('authorization') || '').replace('Bearer ', '').trim()

  // A browser landing here without a credential starts a login instead, with the provider left to oauth.ee to ask
  if (!key) {
    return oauthStartLogin(event)
  }

  const query = getQuery(event)

  return await authExchange(event, {
    account: query.db || query.account,
    invite: query.invite,
    ip: (getRequestIP(event, { xForwardedFor: true }) || '127.0.0.1').replace('::1', '127.0.0.1'),
    key
  })
})
