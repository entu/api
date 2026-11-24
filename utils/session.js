const day = 24 * 60 * 60

// No sign-in lasts longer than this, however often it is refreshed
const sessionLifetime = 30 * day

// An unused sign-in's record is dropped this long after its last refresh - the 7-day refresh token has stopped working by then anyway
const idleLifetime = 14 * day

// A refresh token works this long, so a client that has not refreshed for a week signs in again
const refreshTokenLifetime = 7 * day

// Keeps a just exchanged session for refresh and returns its first refresh token. `accounts` is what a refresh may reach: '*' for an Entu sign-in (every database the login is in), or the list an OAuth client was consented
export async function sessionKeep (event, sessionId, { accounts, client }) {
  if (!isAccountLimit(accounts)) {
    throw createError({ statusCode: 400, statusMessage: 'No database to limit to' })
  }

  const collection = await sessionCollection()

  // Only a session the exchange just used (`refreshed` set) and nobody kept yet (no `generation`)
  const session = await collection.findOneAndUpdate(
    { _id: getObjectId(sessionId), refreshed: { $exists: true }, generation: { $exists: false } },
    { $set: { accounts, ...(client ? { client } : {}), generation: 0 } },
    { returnDocument: 'after' }
  )

  if (!session) {
    throw createError({ statusCode: 400, statusMessage: 'No session' })
  }

  return signRefreshToken(event, session, 0)
}

// Trades a refresh token for a new access token and the next refresh token. An Entu sign-in refreshes only at /auth/refresh (IP-bound token, support listed), an OAuth one only at the token endpoint (`oauth`: unbound token, consented databases only). A refresh token used twice ends the session, as one of the two holders stole it
export async function sessionRefresh (event, refreshToken, { oauth }) {
  const payload = tokenVerify(event, 'refresh', refreshToken)

  if (!payload?.sub || !Number.isInteger(payload.gen)) {
    throw oauthError('invalid_grant', 'Invalid or expired refresh token')
  }

  const collection = await sessionCollection()
  const _id = getObjectId(payload.sub)
  const now = Date.now()

  // The dates are checked here too, as the TTL indexes remove records only once a minute
  const session = await collection.findOne({
    _id,
    generation: payload.gen,
    created: { $gt: new Date(now - sessionLifetime * 1000) },
    refreshed: { $gt: new Date(now - idleLifetime * 1000) }
  })

  if (!session || !isAccountLimit(session.accounts)) {
    await collection.deleteOne({ _id })

    throw oauthError('invalid_grant', 'Refresh token expired, revoked or already used')
  }

  // Sent to the wrong route is no sign of theft, so the session stays
  if (oauth !== (session.accounts !== '*')) {
    throw oauthError('invalid_grant', 'Refresh token belongs to the other refresh route')
  }

  // Issued before the rotation, so a failing lookup leaves the client's refresh token valid for a retry
  const auth = await issueAccessToken(event, session, oauth)

  if (!auth) {
    await collection.deleteOne({ _id })

    throw oauthError('invalid_grant', 'No access to any database of this sign-in')
  }

  // Matching the generation makes the rotation atomic, so of two requests with one token only the first wins
  const rotated = await collection.updateOne(
    { _id, generation: payload.gen },
    { $set: { generation: payload.gen + 1, refreshed: new Date() } }
  )

  if (rotated.modifiedCount === 0) {
    await collection.deleteOne({ _id })

    throw oauthError('invalid_grant', 'Refresh token expired, revoked or already used')
  }

  return { ...auth, refreshToken: signRefreshToken(event, session, payload.gen + 1) }
}

// Ends the session behind a refresh token - an invalid token or an ended session is not an error, as there is nothing left to revoke
export async function sessionRevoke (event, refreshToken) {
  const payload = tokenVerify(event, 'refresh', refreshToken, { ignoreExpiration: true })

  if (!payload?.sub) return

  const collection = await sessionCollection()

  await collection.deleteOne({ _id: getObjectId(payload.sub), generation: { $exists: true } })
}

// A new access token for a kept session - its databases are looked up again by the login it was signed in with, so removed ones drop out; undefined when none is left
async function issueAccessToken (event, session, oauth) {
  const user = authSessionIdentity(session)

  if (!user.uid || !user.provider) return

  const onlyAccounts = oauth ? session.accounts : []
  const accounts = await findUserAccounts(user, onlyAccounts)
  const support = oauth ? [] : await findSupportAccounts(user, accounts.map((a) => a.account))

  if (accounts.length === 0 && support.length === 0) return

  return authIssueToken(event, {
    accounts,
    authAt: Math.floor(session.created.getTime() / 1000),
    bindIp: !oauth,
    support,
    until: sessionEnd(session),
    // A passkey created at sign-in counts as new only in that sign-in's first token
    user: authIdentity({ ...user, registered: undefined }, accounts)
  })
}

// When a session ends, however often it is refreshed
function sessionEnd (session) {
  return new Date(session.created.getTime() + sessionLifetime * 1000)
}

// The refresh token for one generation of a session - 7 days, or less when the session ends sooner
function signRefreshToken (event, session, generation) {
  const secondsLeft = Math.ceil((sessionEnd(session).getTime() - Date.now()) / 1000)
  const expiresIn = Math.max(1, Math.min(refreshTokenLifetime, secondsLeft))

  return tokenSign(event, 'refresh', { gen: generation }, { expiresIn, subject: session._id.toString() })
}

// A valid limit is '*' or a non-empty list of names - never an empty list, which findUserAccounts reads as every database
function isAccountLimit (accounts) {
  const isList = Array.isArray(accounts) && accounts.length > 0 && accounts.every((account) => typeof account === 'string' && account)

  return accounts === '*' || isList
}

// The session collection - its TTL indexes (import `syncIndexes.js`) drop a session 30 days after `created` and 14 days after `refreshed`
async function sessionCollection () {
  const connection = await connectDb('entu')

  return connection.collection('session')
}
