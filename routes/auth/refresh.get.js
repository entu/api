defineRouteMeta({
  openAPI: {
    tags: ['Authentication'],
    description: 'Exchange the refresh token from a sign-in for a fresh 12-hour, IP-bound JWT and the next refresh token. See [Refreshing a Token](https://entu.ee/api/authentication/#refreshing-a-token).',
    security: [], // The refresh token is the credential, not a JWT
    parameters: [
      {
        name: 'authorization',
        in: 'header',
        required: true,
        schema: {
          type: 'string',
          description: 'Refresh token',
          example: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
        }
      }
    ],
    responses: {
      200: {
        description: 'Fresh JWT, refresh token and accessible databases',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                accounts: {
                  type: 'array',
                  description: 'Databases the login is a person in — empty only when `support` lists one',
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
                          name: { type: 'string', description: 'Person name, or ID', example: 'User 1' }
                        }
                      }
                    }
                  }
                },
                support: {
                  type: 'array',
                  description: 'Entu support only: databases whose owner granted support access, open until `until`; omitted when empty',
                  items: {
                    type: 'object',
                    properties: {
                      _id: { type: 'string', description: 'Database name', example: 'mydatabase' },
                      name: { type: 'string', description: 'Database name', example: 'mydatabase' },
                      until: { type: 'string', format: 'date-time', description: 'Support access end' },
                      user: {
                        type: 'object',
                        description: 'The database entity, which support acts as',
                        properties: {
                          _id: { type: 'string', description: 'Database entity ID', example: '6798938432faaba00f8fc72f' }
                        }
                      }
                    }
                  }
                },
                user: {
                  type: 'object',
                  description: 'Login identity of the sign-in',
                  properties: {
                    uid: { type: 'string', description: 'Provider user ID or passkey credential ID' },
                    provider: { type: 'string', description: 'Provider name' },
                    email: { type: 'string', description: 'Provider e-mail — never for a passkey' },
                    name: { type: 'string', description: 'Provider name; for a passkey the person name in the first database, by name, that has one' },
                    passkeyPublic: { type: 'string', description: 'Passkey public key' },
                    device: { type: 'string', description: 'Passkey device name' }
                  }
                },
                token: { type: 'string', description: '12-hour JWT, bound to this IP; never past 30 days after sign-in' },
                expires: { type: 'string', format: 'date-time', description: 'Token expiry' },
                refreshToken: { type: 'string', description: 'Next refresh token — the presented one stops working' }
              },
              required: ['accounts', 'user', 'token', 'expires', 'refreshToken']
            }
          }
        }
      },
      400: {
        description: '`No key`',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      },
      401: {
        description: '`Invalid refresh token` — invalid, expired, revoked or already used refresh token, or no accessible database left',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      }
    }
  }
})

export default defineEventHandler(async (event) => {
  const key = (event.req.headers.get('authorization') || '').replace('Bearer ', '').trim()

  if (!key) {
    throw createError({ statusCode: 400, statusMessage: 'No key' })
  }

  // Every refusal is a 401, so the webapp and app treat it as signed out
  return await sessionRefresh(event, key, { oauth: false }).catch((error) => {
    if (error.data?.error === 'invalid_grant') {
      throw createError({ statusCode: 401, statusMessage: 'Invalid refresh token' })
    }

    throw error
  })
})
