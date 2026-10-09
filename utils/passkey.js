import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server'

// WebAuthn options for signing in with a stored passkey, with the challenge signed for this browser
export async function passkeySignInOptions (event) {
  const { passkeyRpId } = useRuntimeConfig(event)

  const options = await generateAuthenticationOptions({
    rpID: passkeyRpId,
    userVerification: 'preferred',
    allowCredentials: []
  })

  return { ...options, challengeToken: tokenSign(event, 'passkey-challenge', { challenge: options.challenge }, { bindIp: true, expiresIn: '5m' }) }
}

// WebAuthn options for creating a passkey - an Entu passkey belongs to no person or database, so each is labelled Entu
export async function passkeyRegisterOptions (event) {
  const { passkeyRpId } = useRuntimeConfig(event)

  // Sign-in asks for any passkey without naming one, so only a discoverable passkey can ever be used
  const options = await generateRegistrationOptions({
    rpName: 'Entu',
    rpID: passkeyRpId,
    userName: 'Entu',
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    supportedAlgorithmIDs: [-7, -257] // ES256, RS256
  })

  return { ...options, challengeToken: tokenSign(event, 'passkey-register', { challenge: options.challenge }, { bindIp: true, expiresIn: '5m' }) }
}

// Verifies a passkey assertion against each database's own stored key and returns the identity it proves - a reused id with another key opens nothing
export async function passkeyVerifySignIn (event, body) {
  const { passkeyRpId, passkeyOrigin } = useRuntimeConfig(event)
  const challenge = readChallenge(event, 'passkey-challenge', body?.challengeToken)

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
          id: match.property.uid,
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
    device: first.property.passkey_device
  }
}

// Verifies a new passkey and returns its identity - the id and key come from the verified attestation, never the request body
export async function passkeyVerifyRegister (event, body) {
  const { passkeyRpId, passkeyOrigin } = useRuntimeConfig(event)
  const challenge = readChallenge(event, 'passkey-register', body?.challengeToken)
  let verification

  try {
    verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge: challenge,
      expectedOrigin: passkeyOrigin,
      expectedRPID: passkeyRpId
    })
  }
  catch {
    verification = undefined
  }

  const credential = verification?.verified ? verification.registrationInfo?.credential : undefined

  if (typeof credential?.id !== 'string' || !credential.publicKey) {
    throw createError({ statusCode: 400, statusMessage: 'Registration verification failed' })
  }

  // A "none" attestation does not prove the private key, so a stored id - with any key - is a copy, never a new passkey
  if ((await findCredential(credential.id)).length > 0) {
    throw createError({ statusCode: 400, statusMessage: 'Passkey is already registered' })
  }

  const publicKey = Buffer.from(credential.publicKey).toString('base64url')

  const device = typeof body.deviceName === 'string' && body.deviceName.trim() ? body.deviceName.trim().slice(0, 100) : undefined

  return { provider: 'passkey', id: credential.id, publicKey, device, registered: true }
}

// Ends a verified passkey step: the webapp page (with `state`) gets a code for /auth/callback, the native app a token as from GET /auth
export async function passkeyFinish (event, identity, body) {
  const ip = authRequestIp(event)

  if (body.state) {
    const sessionId = await oauthCreateSession(ip, identity, { pending: true })

    return { code: oauthSignPasskeyCode(event, sessionId, body.state) }
  }

  const sessionId = await oauthCreateSession(ip, identity)

  return await authExchange(event, {
    account: typeof body.db === 'string' && body.db ? formatDatabaseName(body.db) : undefined,
    invite: typeof body.invite === 'string' && body.invite ? body.invite : undefined,
    sessionId
  })
}

// The label a passkey's entu_user value shows - its device name plus the last four characters of its id
export function passkeyLabel (property) {
  return `${property.passkey_device || ''} ${property._id.toString().slice(-4).toUpperCase()}`.trim()
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

// Returns the challenge from a token of this type signed for this browser
function readChallenge (event, use, token) {
  const payload = tokenVerify(event, use, token, { bindIp: true })

  if (!payload?.challenge) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid or expired challenge' })
  }

  return payload.challenge
}

// Finds the passkey entu_user values for a credential id in every database, with the person each belongs to
async function findCredential (credentialId) {
  const entuDb = await connectDb('entu')
  const dbs = await entuDb.admin().listDatabases()

  const matches = await Promise.all(
    dbs.databases
      .filter(({ name }) => !mongoDbSystemDbs.includes(name))
      .map(async ({ name: account }) => {
        const db = await connectDb(account)

        const persons = await db.collection('entity').find(
          { 'auth.user': { $elemMatch: { uid: credentialId, provider: 'passkey' } } },
          { projection: { 'auth.user': true } }
        ).toArray()

        return persons.flatMap((person) => person.auth.user
          .filter((property) => property.provider === 'passkey' && property.uid === credentialId && property.passkey_public)
          .map((property) => ({ account, db, personId: person._id, property })))
      })
  )

  return matches.flat()
}
