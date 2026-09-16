import jwt from 'jsonwebtoken'
import { createHash } from 'node:crypto'

const providers = ['e-mail', 'google', 'apple', 'smart-id', 'mobile-id', 'id-card']

// Languages routes/auth/[provider].get.js accepts for the provider login
export const languages = ['en', 'et']

// Lifetime per signed artifact - nothing is stored, so these are the only expiry there is
const lifetimes = {
  client: '365d',
  code: '5m',
  state: '10m'
}

// Providers the authorize page offers - the same set routes/auth/[provider].get.js accepts
export function oauthProviders () {
  return providers
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
