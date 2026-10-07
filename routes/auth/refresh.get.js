defineRouteMeta({
  openAPI: {
    tags: ['Authentication'],
    description: 'Exchange a JWT, also an expired one, for a fresh 12-hour token from the same IP; subject to 14-day idle and 30-day session limits. See [Refreshing a Token](https://entu.ee/api/authentication/#refreshing-a-token).',
    security: [], // Uses the existing JWT, not account scoping
    parameters: [
      {
        name: 'authorization',
        in: 'header',
        required: true,
        schema: {
          type: 'string',
          description: 'JWT to refresh',
          example: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
        }
      }
    ],
    responses: {
      200: {
        description: 'Fresh JWT and accessible databases',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                accounts: {
                  type: 'array',
                  description: 'Accessible databases — never empty',
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
                user: {
                  type: 'object',
                  description: 'Login identity from the presented token — empty for an API key',
                  properties: {
                    uid: { type: 'string', description: 'Provider user ID or passkey credential ID' },
                    provider: { type: 'string', description: 'Provider name' },
                    email: { type: 'string', description: 'Provider e-mail — never for a passkey' },
                    name: { type: 'string', description: 'Provider name; for a passkey the person name in the first database, by name, that has one' },
                    passkeyPublic: { type: 'string', description: 'Passkey public key' },
                    device: { type: 'string', description: 'Passkey device name' }
                  }
                },
                token: { type: 'string', description: '12-hour JWT, bound to this IP' },
                expires: { type: 'string', format: 'date-time', description: 'Token expiry' }
              },
              required: ['accounts', 'user', 'token', 'expires']
            }
          }
        }
      },
      400: {
        description: '`No key`',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      },
      401: {
        description: 'Bad signature, wrong or no IP binding, `Token too old, re-authenticate`, `Session expired, re-authenticate`, `No accessible accounts`',
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

  const decoded = tokenVerify(event, 'access', key, { bindIp: true, ignoreExpiration: true, legacy: true })

  if (!decoded) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid token' })
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

  let accounts

  if (decoded.user?.uid && decoded.user?.provider) {
    // OAuth session: rediscover accounts by a live identity scan that replaces the old claim, so revoked databases drop out and new ones appear
    accounts = await findUserAccounts(decoded.user)
  }
  else {
    // API-key session (or a passkey token issued before passkeys carried an identity): re-validate the existing accounts claim, dropping entities that no longer exist
    accounts = (await Promise.all(
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

        if (!person) {
          return null
        }

        return { account, userId: person._id, userName: person.private?.name?.at(0)?.string }
      })
    )).filter(Boolean)
  }

  if (accounts.length === 0) {
    throw createError({ statusCode: 401, statusMessage: 'No accessible accounts' })
  }

  // A passkey created at sign-in counts as new only in that sign-in's token, and its name follows the persons it is stored on
  const user = decoded.user?.uid && decoded.user?.provider
    ? authIdentity({ ...decoded.user, registered: undefined }, accounts)
    : decoded.user || {}

  return authIssueToken(event, { accounts, authAt: decoded.authAt, user })
})
