import { verifyAuthenticationResponse } from '@simplewebauthn/server'
import jwt from 'jsonwebtoken'

// Signs a WebAuthn challenge for the browser that asked for it - typed, so no other Entu JWT passes as one
export function passkeySignChallenge (event, challenge) {
  const { jwtSecret } = useRuntimeConfig(event)

  return jwt.sign({ challenge, use: 'passkey-challenge' }, jwtSecret, { audience: requestIp(event), expiresIn: '5m' })
}

// Returns the challenge from a token signed by passkeySignChallenge for this browser
export function passkeyReadChallenge (event, token) {
  const { jwtSecret } = useRuntimeConfig(event)
  let payload

  try {
    payload = jwt.verify(token, jwtSecret, { audience: requestIp(event) })
  }
  catch {
    throw createError({ statusCode: 400, statusMessage: 'Invalid or expired challenge' })
  }

  if (payload.use !== 'passkey-challenge') {
    throw createError({ statusCode: 400, statusMessage: 'Not a passkey challenge' })
  }

  return payload.challenge
}

// Verifies a passkey assertion against each database's own stored key and returns the identity it proves - a reused id with another key opens nothing.
export async function passkeyVerify (event, body) {
  const { passkeyRpId, passkeyOrigin } = useRuntimeConfig(event)
  const challenge = passkeyReadChallenge(event, body?.challengeToken)

  // The credential id goes straight into a Mongo filter, so only a plain string may reach it
  if (typeof body.id !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'Invalid credential id' })
  }

  const matches = await findCredential(body.id)

  const verified = (await Promise.all(matches.map(async (match) => {
    try {
      const verification = await verifyAuthenticationResponse({
        response: {
          id: body.id,
          rawId: body.rawId,
          response: body.response,
          type: body.type
        },
        expectedChallenge: challenge,
        expectedOrigin: passkeyOrigin,
        expectedRPID: passkeyRpId,
        credential: {
          id: match.property.passkey_id,
          publicKey: Buffer.from(match.property.passkey_public, 'base64url'),
          counter: match.property.passkey_counter || 0
        }
      })

      return verification.verified ? { ...match, newCounter: verification.authenticationInfo?.newCounter } : null
    }
    catch {
      return null
    }
  }))).filter(Boolean)

  if (verified.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Authentication verification failed' })
  }

  // Bump the counter in every database where this key verified
  await Promise.all(verified.map(async ({ account, db, personId, property, newCounter }) => {
    await db.collection('property').updateOne(
      { _id: property._id },
      { $set: { passkey_counter: newCounter ?? (property.passkey_counter || 0) + 1 } }
    )

    await aggregateEntity({ account, user: personId, userStr: personId.toString(), db }, personId)
  }))

  const first = verified.at(0)

  return {
    provider: 'passkey',
    id: body.id,
    publicKey: first.property.passkey_public,
    device: first.property.passkey_device,
    name: first.personName
  }
}

// True when the credential id is already stored somewhere with a different public key
export async function passkeyIdTaken (credentialId, publicKey) {
  const matches = await findCredential(credentialId)

  return matches.some(({ property }) => property.passkey_public !== publicKey)
}

// True while the passkey is still stored on some person - a removed passkey must not come back through an older token
export async function passkeyExists (credentialId, publicKey) {
  if (typeof credentialId !== 'string') {
    return false
  }

  const matches = await findCredential(credentialId)

  return matches.some(({ property }) => property.passkey_public === publicKey)
}

// Finds the entu_passkey values for a credential id in every database, with the person each belongs to
async function findCredential (credentialId) {
  const entuDb = await connectDb('entu')
  const dbs = await entuDb.admin().listDatabases()

  const matches = await Promise.all(
    dbs.databases
      .filter(({ name }) => !mongoDbSystemDbs.includes(name))
      .map(async ({ name: account }) => {
        const db = await connectDb(account)

        const persons = await db.collection('entity').find(
          { 'private.entu_passkey.passkey_id': credentialId },
          { projection: { 'private.name.string': true, 'private.entu_passkey': true } }
        ).toArray()

        return persons.flatMap((person) => person.private.entu_passkey
          .filter((property) => property.passkey_id === credentialId && property.passkey_public)
          .map((property) => ({ account, db, personId: person._id, personName: person.private?.name?.at(0)?.string, property })))
      })
  )

  return matches.flat()
}

// Caller IP as used for token audiences across the auth routes
function requestIp (event) {
  return (getRequestIP(event, { xForwardedFor: true }) || '127.0.0.1').replace('::1', '127.0.0.1')
}
