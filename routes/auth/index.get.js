defineRouteMeta({
  openAPI: {
    tags: ['Authentication'],
    description: 'Exchange an API key or a single-use login session token for a 12-hour, IP-bound JWT; without an `Authorization` header it starts a login. See [Getting a Token](https://entu.ee/api/authentication/#getting-a-token).',
    security: [], // Uses an API key or session token, not a JWT
    parameters: [
      {
        name: 'authorization',
        in: 'header',
        schema: {
          type: 'string',
          description: 'API key or session token; omit to start a login',
          example: 'Bearer nEkPYET5fYjJqktNz9yfLxPF'
        }
      },
      {
        name: 'db',
        in: 'query',
        schema: {
          type: 'string',
          description: 'Limit to this database; enables [automatic user creation](https://entu.ee/configuration/users/#automatic-user-creation)',
          example: 'mydatabase'
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
          description: 'Invite token — session token only; links this identity to the invited person and limits to its database'
        }
      },
      {
        name: 'next',
        in: 'query',
        schema: {
          type: 'string',
          description: 'Login start: return URL, session token appended. Without it: JSON `{ key }`',
          example: 'https://your-app.com/auth?key='
        }
      },
      {
        name: 'lang',
        in: 'query',
        schema: {
          type: 'string',
          enum: ['en', 'et'],
          description: 'Login start: OAuth.ee page language'
        }
      }
    ],
    responses: {
      200: {
        description: 'JWT and accessible databases',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                accounts: {
                  type: 'array',
                  description: 'Accessible databases — may be empty after a login',
                  items: {
                    type: 'object',
                    properties: {
                      _id: { type: 'string', description: 'Database name', example: 'mydatabase' },
                      name: { type: 'string', description: 'Database name', example: 'mydatabase' },
                      user: {
                        type: 'object',
                        description: 'Person entity signed in as',
                        properties: {
                          _id: { type: 'string', description: 'Person entity ID', example: '6798938432faaba00f8fc72f' },
                          name: { type: 'string', description: 'Person name, or ID', example: 'User 1' },
                          new: { type: 'boolean', description: 'Person created by this sign-in' }
                        }
                      }
                    }
                  }
                },
                user: {
                  type: 'object',
                  description: 'Login identity — empty for an API key',
                  properties: {
                    uid: { type: 'string', description: 'Provider user ID or passkey credential ID' },
                    provider: { type: 'string', description: 'Provider name' },
                    email: { type: 'string', description: 'Provider e-mail — never for a passkey' },
                    name: { type: 'string', description: 'Provider name; for a passkey the person name in the first database, by name, that has one' },
                    passkeyPublic: { type: 'string', description: 'Passkey public key' },
                    device: { type: 'string', description: 'Passkey device name' },
                    registered: { type: 'boolean', description: 'Passkey created in this sign-in' }
                  }
                },
                token: { type: 'string', description: '12-hour JWT (`use: access`), bound to this IP' },
                expires: { type: 'string', format: 'date-time', description: 'Token expiry' },
                conflict: { type: 'string', enum: ['invite'], description: 'Invite targets another person than this identity is linked to' }
              },
              required: ['accounts', 'user', 'token', 'expires']
            }
          }
        }
      },
      302: { description: 'Login redirect, without an Authorization header' },
      400: {
        description: '`Invalid or expired invite`; session token without invite: `db` is a system database',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      },
      401: {
        description: '`Invalid credential` — unknown API key; invalid, expired, used or wrong-IP session token',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      },
      404: {
        description: 'Session token without invite: `db` not found',
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
    key
  })
})
