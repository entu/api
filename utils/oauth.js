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

// Sends the user to the oauth.ee login, or a webapp passkey page. `state` comes back from oauthCompleteLogin, so callers store nothing.
export function oauthStartLogin (event, { provider, register = false, state = {} } = {}) {
  const { appUrl, oauthId } = useRuntimeConfig(event)
  const { lang, next } = getQuery(event)
  const signedState = tokenSign(event, 'state', { next, ...state, provider, ...(register ? { register } : {}) }, { bindIp: true, expiresIn: '5m' })

  // The webapp pages stand in for oauth.ee - they run the passkey prompt and return to /auth/callback the same way
  if (provider === 'passkey') {
    const url = new URL(register ? '/auth/passkey-register' : '/auth/passkey-sign-in', appUrl)

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
  const decodedState = tokenVerify(event, 'state', state, { bindIp: true })

  if (!decodedState) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid or expired login state' })
  }

  // The state names the provider, so a passkey code is only accepted for a login started as a passkey login
  const sessionId = decodedState.provider === 'passkey'
    ? await claimPasskeySession(event, code, state)
    : await oauthCreateSession(authRequestIp(event), await fetchOauthEeUser(event, code))

  const token = tokenSign(event, 'session', {}, { bindIp: true, expiresIn: '5m', subject: sessionId })

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
  return tokenSign(event, 'passkey-code', { session: sessionId, state: hashState(state) }, { bindIp: true, expiresIn: '1m' })
}

// Checks the state a passkey page sends belongs to a passkey login of this kind (sign-in or create) started from this browser
export function oauthVerifyPasskeyState (event, state, { register = false } = {}) {
  const payload = tokenVerify(event, 'state', state, { bindIp: true })

  if (!payload) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid or expired login state' })
  }

  if (payload.provider !== 'passkey' || !!payload.register !== register) {
    throw createError({ statusCode: 400, statusMessage: 'Not a login state for this passkey step' })
  }
}

// Claims the pending session a passkey code names - the atomic update makes the code single use
async function claimPasskeySession (event, code, state) {
  const payload = tokenVerify(event, 'passkey-code', code, { bindIp: true })

  if (!payload || payload.state !== hashState(state)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid or expired passkey code' })
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

// Signs an OAuth artifact - registrations and codes are self-contained JWTs, so the flow needs no storage
export function oauthSign (event, type, payload) {
  return tokenSign(event, type, payload, { expiresIn: lifetimes[type] })
}

// Verifies an OAuth artifact of this type, so a client registration can't be replayed as a code
export function oauthVerify (event, type, token) {
  const payload = tokenVerify(event, type, token)

  if (!payload) {
    throw oauthError('invalid_grant', `Invalid or expired ${type}`)
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
