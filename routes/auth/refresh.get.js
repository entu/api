import jwt from 'jsonwebtoken'

defineRouteMeta({
  openAPI: {
    tags: ['Authentication'],
    description: 'Refresh an existing JWT for a fresh 12-hour token. Verifies signature and IP, re-validates account access, and returns a new token. Refusal cases: the presented token has not been refreshed in over 14 days, or the original authentication is over 30 days old (both require full re-authentication).',
    security: [], // Uses the existing JWT, not account scoping
    parameters: [
      {
        name: 'authorization',
        in: 'header',
        required: true,
        schema: {
          type: 'string',
          description: 'Bearer token — the JWT to refresh',
          example: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
        }
      }
    ],
    responses: {
      200: {
        description: 'Fresh JWT with accessible accounts',
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
                    name: { type: 'string' },
                    email: { type: 'string' }
                  }
                },
                token: { type: 'string', description: '12-hour JWT' },
                expires: { type: 'string', format: 'date-time', description: 'Token expiry as ISO 8601 datetime' }
              }
            }
          }
        }
      },
      401: {
        description: 'Invalid token, IP mismatch, token not refreshed in over 14 days, original authentication over 30 days old, or no accessible accounts',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      }
    }
  }
})

export default defineEventHandler(async (event) => {
  const { jwtSecret } = useRuntimeConfig(event)
  const key = (event.req.headers.get('authorization') || '').replace('Bearer ', '').trim()

  if (!key) {
    throw createError({ statusCode: 400, statusMessage: 'No key' })
  }

  const audience = (getRequestIP(event, { xForwardedFor: true }) || '127.0.0.1').replace('::1', '127.0.0.1')

  let decoded
  try {
    decoded = jwt.verify(key, jwtSecret, { audience, ignoreExpiration: true })
  }
  catch (e) {
    throw createError({ statusCode: 401, statusMessage: e.message || e })
  }

  const now = Math.floor(Date.now() / 1000)

  // Refuse to refresh a token that has not been refreshed for over 14 days
  if (!decoded.iat || now - decoded.iat > 14 * 24 * 60 * 60) {
    throw createError({ statusCode: 401, statusMessage: 'Token too old, re-authenticate' })
  }

  // Absolute session ceiling: refuse once the original authentication is over 30 days old
  if (!decoded.authAt || now - decoded.authAt > 30 * 24 * 60 * 60) {
    throw createError({ statusCode: 401, statusMessage: 'Session expired, re-authenticate' })
  }

  const accounts = []
  const accountUsersIds = {}

  function addAccount (account, userId, userName) {
    accountUsersIds[account] = userId.toString()
    accounts.push({ _id: account, name: account, user: { _id: userId.toString(), name: userName } })
  }

  // Re-validate account access: confirm each user entity still exists
  const accountResults = await Promise.all(
    Object.entries(decoded.accounts || {}).map(async ([account, userId]) => {
      let person

      try {
        const accountCon = await connectDb(account)
        person = await accountCon.collection('entity').findOne(
          { _id: getObjectId(userId) },
          { projection: { _id: true, 'private.name.string': true } }
        )
      }
      catch {
        // Malformed account/userId claim or unreachable db → drop this account
        return null
      }

      if (!person)
        return null

      return { account, userId: person._id, userName: person.private?.name?.at(0)?.string || person._id.toString() }
    })
  )

  for (const result of accountResults) {
    if (result)
      addAccount(result.account, result.userId, result.userName)
  }

  if (accounts.length === 0) {
    throw createError({ statusCode: 401, statusMessage: 'No accessible accounts' })
  }

  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000)
  const tokenData = {
    accounts: accountUsersIds,
    exp: Math.floor(expiresAt.getTime() / 1000),
    authAt: decoded.authAt // preserve original authentication time across refreshes
  }

  if (decoded.user) {
    tokenData.user = decoded.user
  }

  return {
    accounts,
    user: decoded.user || {},
    token: jwt.sign(tokenData, jwtSecret, { audience }),
    expires: expiresAt.toISOString()
  }
})
