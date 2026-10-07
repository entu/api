import jwt from 'jsonwebtoken'
import { createHash } from 'node:crypto'

// Languages the OAuth.ee login page supports
const languages = ['en', 'et']

// Lifetime per signed artifact - nothing is stored, so these are the only expiry there is
const lifetimes = {
  client: '365d',
  code: '5m'
}

// Public base URL this request arrived on, so redirects stay on the host the user is already using
export function oauthBaseUrl (event) {
  const host = event.req.headers.get('host') || 'localhost'
  const proto = (event.req.headers.get('x-forwarded-proto') || 'http').split(',').at(0).trim()

  return `${proto}://${host}`
}

// Public origin of the API itself - needed where a document served on mcp.entu.app has to name api.entu.app
export function oauthApiUrl (event) {
  const { apiUrl } = useRuntimeConfig(event)

  return apiUrl || oauthBaseUrl(event)
}

// Sends the user to the oauth.ee login, or the webapp passkey page. `state` comes back from oauthCompleteLogin, so callers store nothing.
export function oauthStartLogin (event, { provider, state = {} } = {}) {
  const { appUrl, jwtSecret, oauthId } = useRuntimeConfig(event)
  const { lang, next } = getQuery(event)
  const audience = (getRequestIP(event, { xForwardedFor: true }) || '127.0.0.1').replace('::1', '127.0.0.1')
  const signedState = jwt.sign({ next, ...state, provider, use: 'state' }, jwtSecret, { audience, expiresIn: '5m' })

  // The webapp page stands in for oauth.ee - it runs the passkey prompt and returns to /auth/callback the same way
  if (provider === 'passkey') {
    const url = new URL('/auth/passkey-sign-in', appUrl)

    url.searchParams.set('state', signedState)

    return redirect(url.toString(), 302)
  }

  const params = new URLSearchParams({
    client_id: oauthId,
    redirect_uri: `${getRequestURL(event).origin}/auth/callback`,
    response_type: 'code',
    scope: 'openid',
    state: signedState
  })

  // Passed through when the caller set it; otherwise OAuth.ee picks the language itself
  if (languages.includes(lang)) {
    params.set('lang', lang)
  }

  const url = new URL('https://oauth.ee')

  url.pathname = provider ? `/auth/${provider}` : '/auth'
  url.search = params.toString()

  return redirect(url.toString(), 302)
}

// Completes a login - creates the session and returns its id and token, with the state the caller sent
export async function oauthCompleteLogin (event, code, state) {
  const { jwtSecret } = useRuntimeConfig(event)
  const audience = (getRequestIP(event, { xForwardedFor: true }) || '127.0.0.1').replace('::1', '127.0.0.1')
  const decodedState = jwt.verify(state, jwtSecret, { audience })

  if (decodedState.use !== 'state') {
    throw createError({ statusCode: 400, statusMessage: 'Not a login state' })
  }

  // The state names the provider, so a passkey code is only accepted for a login started as a passkey login
  const sessionId = decodedState.provider === 'passkey'
    ? await claimPasskeySession(event, code, state, audience)
    : await oauthCreateSession(audience, await fetchOauthEeUser(event, code))

  const token = jwt.sign({ use: 'session' }, jwtSecret, {
    audience,
    subject: sessionId,
    expiresIn: '5m'
  })

  return { id: sessionId, state: decodedState, token }
}

// Stores a login session and returns its id - a pending one stays unusable until /auth/callback claims it
export async function oauthCreateSession (ip, user, { pending = false } = {}) {
  const connection = await connectDb('entu')

  const session = await connection.collection('session').insertOne({
    created: new Date(),
    ...(pending ? { pending: true } : {}),
    user: { ip, ...user }
  })

  return session.insertedId.toString()
}

// Signs the code the passkey page hands to /auth/callback - it names a pending session and the state it was issued for
export function oauthSignPasskeyCode (event, sessionId, state) {
  const { jwtSecret } = useRuntimeConfig(event)
  const audience = (getRequestIP(event, { xForwardedFor: true }) || '127.0.0.1').replace('::1', '127.0.0.1')

  return jwt.sign({ session: sessionId, state: hashState(state), use: 'passkey' }, jwtSecret, { audience, expiresIn: '1m' })
}

// Checks the state the passkey page sends belongs to a passkey login started from this browser
export function oauthVerifyPasskeyState (event, state) {
  const { jwtSecret } = useRuntimeConfig(event)
  const audience = (getRequestIP(event, { xForwardedFor: true }) || '127.0.0.1').replace('::1', '127.0.0.1')
  let payload

  try {
    payload = jwt.verify(state, jwtSecret, { audience })
  }
  catch {
    throw createError({ statusCode: 400, statusMessage: 'Invalid or expired login state' })
  }

  if (payload.use !== 'state' || payload.provider !== 'passkey') {
    throw createError({ statusCode: 400, statusMessage: 'Not a passkey login state' })
  }
}

// Claims the pending session a passkey code names - the atomic update makes the code single use
async function claimPasskeySession (event, code, state, audience) {
  const { jwtSecret } = useRuntimeConfig(event)
  let payload

  try {
    payload = jwt.verify(code, jwtSecret, { audience })
  }
  catch {
    throw createError({ statusCode: 400, statusMessage: 'Invalid or expired passkey code' })
  }

  if (payload.use !== 'passkey' || payload.state !== hashState(state)) {
    throw createError({ statusCode: 400, statusMessage: 'Not a passkey code for this login' })
  }

  const connection = await connectDb('entu')

  const session = await connection.collection('session').findOneAndUpdate(
    { _id: getObjectId(payload.session), pending: true, deleted: { $exists: false } },
    { $unset: { pending: '' } }
  )

  if (!session) {
    throw createError({ statusCode: 400, statusMessage: 'Passkey code already used' })
  }

  return session._id.toString()
}

// Hash of a login state, so a passkey code is tied to its login without carrying the state itself
function hashState (state) {
  return createHash('sha256').update(String(state)).digest('base64url')
}

// Exchanges an oauth.ee code for the user's profile
async function fetchOauthEeUser (event, code) {
  const { oauthId, oauthSecret } = useRuntimeConfig(event)

  const tokenResponse = await $fetch('https://oauth.ee/api/token', {
    method: 'POST',
    body: {
      client_id: oauthId,
      client_secret: oauthSecret,
      code,
      grant_type: 'authorization_code'
    }
  })

  const profile = await $fetch('https://oauth.ee/api/user', {
    headers: { Authorization: `Bearer ${tokenResponse.access_token}` }
  })

  return {
    provider: profile.provider,
    id: profile.id,
    name: profile.name,
    email: profile.email
  }
}

// Signs an OAuth artifact - registrations, state and codes are self-contained JWTs, so the flow needs no storage
export function oauthSign (event, type, payload) {
  const { jwtSecret } = useRuntimeConfig(event)

  return jwt.sign({ ...payload, use: type }, jwtSecret, { expiresIn: lifetimes[type] })
}

// Verifies an OAuth artifact and rejects one of the wrong type, so a client registration can't be replayed as a code
export function oauthVerify (event, type, token) {
  const { jwtSecret } = useRuntimeConfig(event)
  let payload

  try {
    payload = jwt.verify(token, jwtSecret)
  }
  catch {
    throw oauthError('invalid_grant', `Invalid or expired ${type}`)
  }

  if (payload.use !== type) {
    throw oauthError('invalid_grant', `Not a valid ${type}`)
  }

  return payload
}

// Verifies a PKCE code verifier against the S256 challenge captured at authorization time
export function oauthVerifyChallenge (codeVerifier, codeChallenge) {
  return createHash('sha256').update(codeVerifier || '').digest('base64url') === codeChallenge
}

// OAuth 2.1 error response (RFC 6749 section 5.2) - the body shape clients expect, not Entu's statusMessage shape
export function oauthError (error, description, statusCode = 400) {
  return createError({
    statusCode,
    statusMessage: description,
    data: { error, error_description: description }
  })
}
