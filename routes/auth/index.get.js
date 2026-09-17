import { createHash } from 'node:crypto'
import jwt from 'jsonwebtoken'

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
      }
    }
  }
})

export default defineEventHandler(async (event) => {
  const { jwtSecret } = useRuntimeConfig(event)
  const key = (event.req.headers.get('authorization') || '').replace('Bearer ', '').trim()

  // A browser landing here without a credential starts a login instead, with the provider left to oauth.ee to ask
  if (!key) {
    return oauthStartLogin(event)
  }

  const connection = await connectDb('entu')
  const audience = (getRequestIP(event, { xForwardedFor: true }) || '127.0.0.1').replace('::1', '127.0.0.1')
  let session
  let apiKeyHash

  try {
    const decoded = jwt.verify(key, jwtSecret, { audience })

    // Only a session token opens a session — any other Entu JWT falls through to the API key branch below
    if (decoded.use !== 'session') {
      throw createError({ statusCode: 400, statusMessage: 'Not a session token' })
    }

    session = await connection.collection('session').findOneAndUpdate(
      { _id: getObjectId(decoded.sub), deleted: { $exists: false } },
      { $set: { deleted: new Date() } }
    )

    if (!session) {
      throw createError({ statusCode: 400, statusMessage: 'No session' })
    }
    if (!session.user?.email) {
      throw createError({ statusCode: 400, statusMessage: 'No user email' })
    }
  }
  catch {
    apiKeyHash = createHash('sha256').update(key).digest('hex')
  }

  const query = getQuery(event)
  let onlyForAccount = query.db || query.account

  if (query.invite && !onlyForAccount) {
    const payload = jwt.decode(query.invite)
    if (payload?.db) {
      onlyForAccount = payload.db
    }
  }

  const accounts = []
  const accountUsersIds = {}

  function addAccount (account, userId, userName, extra = {}) {
    accountUsersIds[account] = userId.toString()
    accounts.push({ _id: account, name: account, user: { _id: userId.toString(), name: userName, ...extra } })
  }

  const identity = apiKeyHash
    ? { apiKeyHash }
    : { uid: session?.user?.id, provider: session?.user?.provider, email: session?.user?.email }

  const accountResults = await findUserAccounts(identity, onlyForAccount)

  for (const result of accountResults) {
    addAccount(result.account, result.userId, result.userName)
  }

  // Invite acceptance: user arrived via invite link and completed OAuth
  const inviteAttempted = !!(onlyForAccount && session && query.invite)
  let inviteConflict = false

  if (onlyForAccount && session && query.invite) {
    const existingEntry = accounts.find((a) => a._id === onlyForAccount)

    try {
      const inviteData = jwt.verify(query.invite, jwtSecret)

      if (inviteData.db === onlyForAccount) {
        const inviteEntu = { account: onlyForAccount, db: await connectDb(onlyForAccount), systemUser: true }
        const storedInvite = await findStoredInvite(inviteEntu, inviteData.entityId)

        if (!existingEntry) {
          // User has no account in this db yet → accept invite

          if (storedInvite) {
            await replaceInviteWithCredentials(inviteEntu, inviteData.entityId, storedInvite._id, session)
            addAccount(onlyForAccount, inviteData.entityId, session.user.name)
          }
        }
        else if (existingEntry.user._id === inviteData.entityId) {
          // Same entity: clean up orphaned invite property
          if (storedInvite) {
            await replaceInviteWithCredentials(inviteEntu, inviteData.entityId, storedInvite._id, session)
          }
        }
        else {
          // Different entity: user's identity is already linked to another entity
          inviteConflict = true
        }
      }
    }
    catch { /* invalid/expired invite */ }
  }

  // Auto-create user if no account found and invite was not attempted
  if (onlyForAccount && accounts.length === 0 && session && !inviteAttempted) {
    const person = await createUserForAccount(onlyForAccount, session)

    if (person) {
      addAccount(onlyForAccount, person._id, person.name, { new: true })
    }
  }

  const userData = {}
  const tokenData = {}

  if (session?.user?.email || session?.user?.name) {
    userData.email = session?.user?.email
    userData.name = session?.user?.name

    // Provider identity — required for creating new databases (PUT /new)
    if (session?.user?.id && session?.user?.provider) {
      userData.uid = session.user.id
      userData.provider = session.user.provider
    }

    tokenData.user = userData
  }

  if (accounts.length > 0) {
    tokenData.accounts = accountUsersIds
  }

  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000)
  tokenData.exp = Math.floor(expiresAt.getTime() / 1000)
  tokenData.authAt = Math.floor(Date.now() / 1000) // original authentication time — carried unchanged through refreshes

  return {
    accounts,
    user: userData,
    token: jwt.sign(tokenData, jwtSecret, { audience }),
    expires: expiresAt.toISOString(),
    ...(inviteConflict ? { conflict: 'invite' } : {})
  }
})

async function findStoredInvite (entu, entityId) {
  const entity = await entu.db.collection('entity').findOne(
    { _id: getObjectId(entityId) },
    { projection: { 'private.entu_user': true } }
  )

  return entity?.private?.entu_user?.find((u) => u.invite) || null
}

async function replaceInviteWithCredentials (entu, entityId, invitePropId, session) {
  await setEntity(entu, getObjectId(entityId), [{
    type: 'entu_user',
    _id: invitePropId,
    uid: session.user.id,
    email: session.user.email,
    provider: session.user.provider
  }])
}

async function createUserForAccount (account, session) {
  if (!account || !session) return

  const entu = { account, db: await connectDb(account), systemUser: true }

  const database = await entu.db.collection('entity').findOne(
    { 'private._type.string': 'database', 'private.add_user.reference': { $exists: true }, _origin_db: { $exists: false } },
    { projection: { 'private.add_user.reference': true } }
  )

  const parent = database?.private?.add_user?.at(0)?.reference

  if (!parent) return

  const type = await entu.db.collection('entity').findOne(
    { 'private._type.string': 'entity', 'private.name.string': 'person' },
    { projection: { _id: true } }
  )

  if (!type?._id) return

  const properties = [
    { type: '_type', reference: type._id },
    { type: '_parent', reference: parent },
    { type: '_inheritrights', boolean: true },
    { type: 'entu_user', uid: session.user.id, email: session.user.email, provider: session.user.provider },
    { type: 'email', string: session.user.email }
  ]

  if (session.user.name) {
    properties.push({ type: 'name', string: session.user.name })
  }

  const person = await setEntity(entu, null, properties)

  if (!person._id) return

  await setEntity(entu, person._id, [{ type: '_editor', reference: person._id }])

  return { _id: person._id, name: session.user.name }
}
