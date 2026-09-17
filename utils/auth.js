import { createHash } from 'node:crypto'
import jwt from 'jsonwebtoken'

// Exchanges a credential - an API key or a session token - for a 12-hour JWT. The shared body of GET /auth, also
// called by the OAuth token endpoint. `ip` binds the issued token to that address; `bindIp: false` issues one usable
// from anywhere, which an OAuth client needs since it calls from its own servers.
export async function authExchange (event, { account, bindIp = true, invite, ip, key, sessionId }) {
  const { jwtSecret } = useRuntimeConfig(event)
  const connection = await connectDb('entu')
  let session
  let apiKeyHash

  // The OAuth token endpoint has already authenticated the user and passes the session id straight in, so there is
  // no bearer credential to verify - and nothing usable for anyone who intercepted the authorization code
  if (sessionId) {
    session = await consumeSession(connection, sessionId)

    if (!session?.user?.email) {
      throw createError({ statusCode: 400, statusMessage: 'No session' })
    }
  }
  else {
    try {
      const decoded = jwt.verify(key, jwtSecret, { audience: ip })

      // Only a session token opens a session — any other Entu JWT falls through to the API key branch below
      if (decoded.use !== 'session') {
        throw createError({ statusCode: 400, statusMessage: 'Not a session token' })
      }

      session = await consumeSession(connection, decoded.sub)

      if (!session?.user?.email) {
        throw createError({ statusCode: 400, statusMessage: 'No session' })
      }
    }
    catch {
      apiKeyHash = createHash('sha256').update(key).digest('hex')
    }
  }

  let onlyForAccount = account

  if (invite && !onlyForAccount) {
    const payload = jwt.decode(invite)

    if (payload?.db) {
      onlyForAccount = payload.db
    }
  }

  const accounts = []
  const accountUsersIds = {}

  const identity = apiKeyHash
    ? { apiKeyHash }
    : { uid: session?.user?.id, provider: session?.user?.provider, email: session?.user?.email }

  const accountResults = await findUserAccounts(identity, onlyForAccount)

  for (const result of accountResults) {
    addAccount(accounts, accountUsersIds, result.account, result.userId, result.userName)
  }

  // A session is proof on its own - a user with no databases yet still needs a token to create their first one.
  // An API key is only proof if it matched something, so nothing matching means the credential was not valid.
  if (!session && accounts.length === 0) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid credential' })
  }

  // Invite acceptance: user arrived via invite link and completed OAuth
  const inviteAttempted = !!(onlyForAccount && session && invite)
  let inviteConflict = false

  if (onlyForAccount && session && invite) {
    const existingEntry = accounts.find((a) => a._id === onlyForAccount)

    try {
      const inviteData = jwt.verify(invite, jwtSecret)

      if (inviteData.db === onlyForAccount) {
        const inviteEntu = { account: onlyForAccount, db: await connectDb(onlyForAccount), systemUser: true }
        const storedInvite = await findStoredInvite(inviteEntu, inviteData.entityId)

        if (!existingEntry) {
          // User has no account in this db yet → accept invite

          if (storedInvite) {
            await replaceInviteWithCredentials(inviteEntu, inviteData.entityId, storedInvite._id, session)
            addAccount(accounts, accountUsersIds, onlyForAccount, inviteData.entityId, session.user.name)
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
      addAccount(accounts, accountUsersIds, onlyForAccount, person._id, person.name, { new: true })
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
    token: jwt.sign(tokenData, jwtSecret, bindIp ? { audience: ip } : {}),
    expires: expiresAt.toISOString(),
    ...(inviteConflict ? { conflict: 'invite' } : {})
  }
}

// Marks a session as used and returns it - the update is the single-use guarantee, so a replay finds nothing
async function consumeSession (connection, id) {
  return await connection.collection('session').findOneAndUpdate(
    { _id: getObjectId(id), deleted: { $exists: false } },
    { $set: { deleted: new Date() } }
  )
}

// Adds one database to both the response list and the token's accounts map
function addAccount (accounts, accountUsersIds, account, userId, userName, extra = {}) {
  accountUsersIds[account] = userId.toString()
  accounts.push({ _id: account, name: account, user: { _id: userId.toString(), name: userName, ...extra } })
}

// Finds a pending invite property on the invited entity
async function findStoredInvite (entu, entityId) {
  const entity = await entu.db.collection('entity').findOne(
    { _id: getObjectId(entityId) },
    { projection: { 'private.entu_user': true } }
  )

  return entity?.private?.entu_user?.find((u) => u.invite) || null
}

// Turns a pending invite property into real credentials for the authenticated user
async function replaceInviteWithCredentials (entu, entityId, invitePropId, session) {
  await setEntity(entu, getObjectId(entityId), [{
    type: 'entu_user',
    _id: invitePropId,
    uid: session.user.id,
    email: session.user.email,
    provider: session.user.provider
  }])
}

// Creates a person entity on first login, when the database is configured to add users automatically
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
