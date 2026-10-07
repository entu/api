import { createHash } from 'node:crypto'

// Caller IP as every IP-bound token is issued for and checked against
export function authRequestIp (event) {
  return (getRequestIP(event, { xForwardedFor: true }) || '127.0.0.1').replace('::1', '127.0.0.1')
}

// Reads the bearer access token into Entu context fields - the one token check REST, GraphQL and MCP share
export function authReadToken (event, account) {
  const ip = authRequestIp(event)
  const tokenStr = (event.req.headers.get('authorization') || '').replace('Bearer ', '').trim()

  if (!tokenStr) {
    return { ip }
  }

  const token = tokenVerify(event, 'access', tokenStr, { legacy: true })

  // An IP-bound token works only from the address it was issued to; an OAuth client's token names no address
  if (!token || (token.aud && token.aud !== ip)) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid token' })
  }

  const userStr = account ? token.accounts?.[account] : undefined

  return {
    ip,
    token,
    ...(userStr ? { user: getObjectId(userStr), userStr } : {}),
    ...(token.user?.email ? { email: token.user.email } : {})
  }
}

// Exchanges a credential - an API key or a session - for a 12-hour access token. The shared body of GET /auth, the
// passkey routes and the OAuth token endpoint; `bindIp: false` issues a token an OAuth client can use from its servers.
export async function authExchange (event, { account, bindIp = true, invite, key, sessionId }) {
  const credential = await resolveCredential(event, key, sessionId)
  const identity = credential.session ? sessionIdentity(credential.session) : undefined

  // An invite only counts with a login identity to link, and limits the sign-in to its own database
  const pendingInvite = identity && invite ? await inviteVerify(event, invite) : undefined
  const onlyForAccount = account || pendingInvite?.account

  if (pendingInvite && pendingInvite.account !== onlyForAccount) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid or expired invite' })
  }

  // A passkey created in this sign-in is stored nowhere yet, so it opens only what an invite, add_user or PUT /new links it to
  const found = identity?.registered ? [] : await findUserAccounts(identity || { apiKeyHash: credential.apiKeyHash }, onlyForAccount)

  // A session is proof on its own - a user with no databases yet still needs a token to create their first one.
  // An API key is only proof if it matched something, so nothing matching means the credential was not valid.
  if (!identity && found.length === 0) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid credential' })
  }

  const accepted = pendingInvite ? await inviteAccept(pendingInvite, identity, found) : {}
  const accounts = accepted.account ? [...found, accepted.account] : found

  // A database that adds users automatically gets a person for a new identity - never while an invite names one
  const created = identity && onlyForAccount && !pendingInvite && accounts.length === 0
    ? await createUserForAccount(onlyForAccount, identity)
    : undefined

  const allAccounts = created ? [{ account: onlyForAccount, userId: created._id, userName: created.name, new: true }] : accounts

  return {
    ...authIssueToken(event, { accounts: allAccounts, bindIp, user: identity ? authIdentity(identity, allAccounts) : {} }),
    ...(accepted.conflict ? { conflict: 'invite' } : {})
  }
}

// Signs the 12-hour access token for a sign-in or refresh; `accounts` are { account, userId, userName, new? } entries
export function authIssueToken (event, { accounts, authAt = Math.floor(Date.now() / 1000), bindIp = true, user = {} }) {
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000)

  // authAt is the original authentication time - carried unchanged through refreshes
  const tokenData = { exp: Math.floor(expiresAt.getTime() / 1000), authAt }

  if (Object.keys(user).length > 0) {
    tokenData.user = user
  }

  if (accounts.length > 0) {
    tokenData.accounts = Object.fromEntries(accounts.map((a) => [a.account, a.userId.toString()]))
  }

  return {
    accounts: accounts.map((a) => ({
      _id: a.account,
      name: a.account,
      user: { _id: a.userId.toString(), name: a.userName || a.userId.toString(), ...(a.new ? { new: true } : {}) }
    })),
    user,
    token: tokenSign(event, 'access', tokenData, { bindIp }),
    expires: expiresAt.toISOString()
  }
}

// The login identity a token carries - a passkey has no name of its own, so it takes the first database person's that has one
export function authIdentity (identity, accounts) {
  const name = identity.provider === 'passkey'
    ? accounts.toSorted((a, b) => a.account.localeCompare(b.account)).find((a) => a.userName)?.userName
    : identity.name

  return withoutUndefined({ ...identity, name })
}

// The credential property that links a person to a login identity - `entu_user` for oauth.ee, `entu_passkey` for a passkey
export function authCredentialProperty ({ uid, provider, email, passkeyPublic, device }) {
  if (provider === 'passkey') {
    return { type: 'entu_passkey', passkey_id: uid, passkey_public: passkeyPublic, passkey_counter: 0, passkey_device: device || 'Unknown Device' }
  }

  return { type: 'entu_user', uid, provider, ...(email ? { email } : {}) }
}

// Turns the bearer credential into a consumed session, or else the hash it is looked up by as an API key
async function resolveCredential (event, key, sessionId) {
  if (sessionId) {
    const session = await consumeSession(sessionId)

    if (!hasIdentity(session)) {
      throw createError({ statusCode: 400, statusMessage: 'No session' })
    }

    return { session }
  }

  // Only a session token opens a session - anything else, valid or not, is tried as an API key
  const decoded = tokenVerify(event, 'session', key, { bindIp: true })
  const session = decoded?.sub ? await consumeSession(decoded.sub) : undefined

  if (hasIdentity(session)) {
    return { session }
  }

  return { apiKeyHash: createHash('sha256').update(key).digest('hex') }
}

// A session is usable when its login gave an e-mail (oauth.ee) or a verified passkey to find the person by
function hasIdentity (session) {
  return !!(session?.user?.email || (session?.user?.provider === 'passkey' && session.user.id && session.user.publicKey))
}

// Marks a session as used and returns it - the update is the single-use guarantee, so a replay finds nothing
async function consumeSession (id) {
  const connection = await connectDb('entu')

  return await connection.collection('session').findOneAndUpdate(
    { _id: getObjectId(id), pending: { $exists: false }, deleted: { $exists: false } },
    { $set: { deleted: new Date() } }
  )
}

// The login identity of a session in the shape tokens, findUserAccounts and authCredentialProperty take
function sessionIdentity (session) {
  return withoutUndefined({
    uid: session.user.id,
    provider: session.user.provider,
    email: session.user.email,
    name: session.user.name,
    passkeyPublic: session.user.publicKey,
    device: session.user.device,
    registered: session.user.registered
  })
}

// Creates a person on first sign-in, when the database is configured to add users automatically
async function createUserForAccount (account, identity) {
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
    authCredentialProperty(identity)
  ]

  if (identity.email) {
    properties.push({ type: 'email', string: identity.email })
  }

  if (identity.name) {
    properties.push({ type: 'name', string: identity.name })
  }

  const person = await setEntity(entu, null, properties)

  if (!person._id) return

  await setEntity(entu, person._id, [{ type: '_editor', reference: person._id }])

  return { _id: person._id, name: identity.name }
}

// Drops undefined fields, so a token carries only what the identity has
function withoutUndefined (object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined))
}
