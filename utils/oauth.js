import jwt from 'jsonwebtoken'
import { createHash } from 'node:crypto'

// Languages the OAuth.ee login page supports
const languages = ['en', 'et']

// Lifetime per signed artifact - nothing is stored, so these are the only expiry there is
const lifetimes = {
  client: '365d',
  code: '5m',
  state: '10m'
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

// Sends the user to the oauth.ee login - without a provider oauth.ee shows its own provider list
export function oauthStartLogin (event, provider) {
  const { jwtSecret, oauthId } = useRuntimeConfig(event)
  const { lang, next } = getQuery(event)
  const audience = (getRequestIP(event, { xForwardedFor: true }) || '127.0.0.1').replace('::1', '127.0.0.1')
  const state = jwt.sign({ next }, jwtSecret, { audience, expiresIn: '5m' })
  const { origin, pathname } = getRequestURL(event)

  const params = new URLSearchParams({
    client_id: oauthId,
    redirect_uri: `${origin}${pathname}`,
    response_type: 'code',
    scope: 'openid',
    state
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

// Completes an oauth.ee login - creates the session and either returns the user to `next` or hands back the key
export async function oauthCompleteLogin (event, code, state) {
  const { jwtSecret, oauthId, oauthSecret } = useRuntimeConfig(event)
  const audience = (getRequestIP(event, { xForwardedFor: true }) || '127.0.0.1').replace('::1', '127.0.0.1')
  const decodedState = jwt.verify(state, jwtSecret, { audience })

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

  const connection = await connectDb('entu')

  const session = await connection.collection('session').insertOne({
    created: new Date(),
    user: {
      ip: audience,
      provider: profile.provider,
      id: profile.id,
      name: profile.name,
      email: profile.email
    }
  })

  const sessionId = jwt.sign({}, jwtSecret, {
    audience,
    subject: session.insertedId.toString(),
    expiresIn: '5m'
  })

  if (decodedState.next) {
    return redirect(`${decodedState.next}${sessionId}`, 302)
  }

  return { key: sessionId }
}

// Signs an OAuth artifact - registrations, state and codes are self-contained JWTs, so the flow needs no storage
export function oauthSign (event, type, payload) {
  const { jwtSecret } = useRuntimeConfig(event)

  return jwt.sign({ ...payload, typ: type }, jwtSecret, { expiresIn: lifetimes[type] })
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

  if (payload.typ !== type) {
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
