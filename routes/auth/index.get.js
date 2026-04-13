import { createHash } from 'node:crypto'
import jwt from 'jsonwebtoken'

defineRouteMeta({
  openAPI: {
    tags: ['Authentication'],
    description: 'Exchange API key or session token for a 48-hour JWT. Accepts permanent API keys (SHA-256 hashed) or temporary tokens from OAuth/passkey flows. Returns JWT with accounts list and user profile. Optional `db` limits auth to one database.',
    security: [], // Uses API key, not JWT
    parameters: [
      {
        name: 'authorization',
        in: 'header',
        required: true,
        schema: {
          type: 'string',
          description: 'Bearer token — permanent API key or temporary session token',
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
          description: 'Invite JWT token to accept during authentication'
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
                    name: { type: 'string' },
                    email: { type: 'string' }
                  }
                },
                token: { type: 'string', description: '48-hour JWT' },
                conflict: { type: 'string', description: 'Set to `invite` if invite targets an entity already linked to another user' }
              }
            }
          }
        }
      },
      400: {
        description: 'No key, invalid session, or missing user email',
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

  const connection = await connectDb('entu')
  const audience = (getRequestIP(event, { xForwardedFor: true }) || '127.0.0.1').replace('::1', '127.0.0.1')
  let session
  let apiKeyHash

  try {
    const decoded = jwt.verify(key, jwtSecret, { audience })
    session = await connection.collection('session').findOneAndUpdate(
      { _id: getObjectId(decoded.sub), deleted: { $exists: false } },
      { $set: { deleted: new Date() } }
    )

    if (!session)
      throw createError({ statusCode: 400, statusMessage: 'No session' })
    if (!session.user?.email)
      throw createError({ statusCode: 400, statusMessage: 'No user email' })
  }
  catch {
    apiKeyHash = createHash('sha256').update(key).digest('hex')
  }

  const query = getQuery(event)
  let onlyForAccount = query.db || query.account

  if (query.invite && !onlyForAccount) {
    const payload = jwt.decode(query.invite)
    if (payload?.db)
      onlyForAccount = payload.db
  }

  const dbs = await connection.admin().listDatabases()
  const accounts = []
  const accountUsersIds = {}

  function addAccount (account, userId, userName, extra = {}) {
    accountUsersIds[account] = userId.toString()
    accounts.push({ _id: account, name: account, user: { _id: userId.toString(), name: userName, ...extra } })
  }

  const accountResults = await Promise.all(
    dbs.databases
      .filter(({ name: account }) => !mongoDbSystemDbs.includes(account) && (!onlyForAccount || onlyForAccount === account))
      .map(async ({ name: account }) => {
        const accountCon = await connectDb(account)
        let person

        if (apiKeyHash) {
          person = await accountCon.collection('entity').findOne(
            { 'private.entu_api_key.string': apiKeyHash },
            { projection: { _id: true, 'private.name.string': true } }
          )
        }
        else if (session) {
          // Step 1: new format — find by uid + provider
          if (session.user?.id && session.user?.provider) {
            person = await accountCon.collection('entity').findOne(
              { 'private.entu_user.uid': session.user.id, 'private.entu_user.provider': session.user.provider },
              { projection: { _id: true, 'private.name.string': true } }
            )
          }

          // Step 2: old format — find by email string and migrate on first login
          if (!person && session.user?.email) {
            const oldPerson = await accountCon.collection('entity').findOne(
              { 'private.entu_user.string': session.user.email },
              { projection: { _id: true, 'private.name.string': true, 'private.entu_user': true } }
            )

            if (oldPerson) {
              const oldProp = oldPerson.private?.entu_user?.find((u) => u.string === session.user.email)

              if (oldProp && session.user?.id && session.user?.provider) {
                await setEntity(
                  { account, db: accountCon, systemUser: true },
                  oldPerson._id,
                  [{ type: 'entu_user', _id: oldProp._id, uid: session.user.id, email: session.user.email, provider: session.user.provider }]
                )
              }

              person = oldPerson
            }
          }
        }

        if (!person)
          return null

        return { account, userId: person._id, userName: person.private?.name?.at(0).string || person._id.toString() }
      })
  )

  for (const result of accountResults) {
    if (result)
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
    tokenData.user = userData
  }

  if (accounts.length > 0) {
    tokenData.accounts = accountUsersIds
  }

  return {
    accounts,
    user: userData,
    token: jwt.sign(tokenData, jwtSecret, { audience, expiresIn: '48h' }),
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
  if (!account || !session)
    return

  const entu = { account, db: await connectDb(account), systemUser: true }

  const database = await entu.db.collection('entity').findOne(
    { 'private._type.string': 'database', 'private.add_user.reference': { $exists: true } },
    { projection: { 'private.add_user.reference': true } }
  )

  const parent = database?.private?.add_user?.at(0)?.reference

  if (!parent)
    return

  const type = await entu.db.collection('entity').findOne(
    { 'private._type.string': 'entity', 'private.name.string': 'person' },
    { projection: { _id: true } }
  )

  if (!type?._id)
    return

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

  if (!person._id)
    return

  await setEntity(entu, person._id, [{ type: '_editor', reference: person._id }])

  return { _id: person._id, name: session.user.name }
}
