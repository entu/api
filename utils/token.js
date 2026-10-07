import jwt from 'jsonwebtoken'

// Last day a token signed before tokens were typed can still be in use - 30 days after typing shipped
const legacyUntil = new Date('2026-11-06T00:00:00Z')

// Signs a typed Entu JWT - `use` names its purpose, so no token can stand in for another kind
export function tokenSign (event, use, payload, { bindIp = false, expiresIn, subject } = {}) {
  const { jwtSecret } = useRuntimeConfig(event)

  return jwt.sign({ ...payload, use }, jwtSecret, {
    ...(bindIp ? { audience: authRequestIp(event) } : {}),
    ...(expiresIn ? { expiresIn } : {}),
    ...(subject ? { subject } : {})
  })
}

// Returns the payload of a valid token of this type, or undefined - `legacy` also takes an untyped one until legacyUntil
export function tokenVerify (event, use, token, { bindIp = false, ignoreExpiration = false, legacy = false } = {}) {
  const { jwtSecret } = useRuntimeConfig(event)

  if (typeof token !== 'string' || !token) return

  let payload

  try {
    payload = jwt.verify(token, jwtSecret, { ignoreExpiration, ...(bindIp ? { audience: authRequestIp(event) } : {}) })
  }
  catch {
    return
  }

  const isLegacy = legacy && payload.use === undefined && Date.now() < legacyUntil.getTime()

  if (payload.use !== use && !isLegacy) return

  return payload
}
