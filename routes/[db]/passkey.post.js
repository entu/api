import { verifyRegistrationResponse } from '@simplewebauthn/server'

defineRouteMeta({ openAPI: { hidden: true } })

export default defineEventHandler(async (event) => {
  const entu = event.context.entu
  const body = await event.req.json()

  if (!entu.user) {
    throw createError({
      statusCode: 403,
      statusMessage: 'No user'
    })
  }

  if (!entu.account) {
    throw createError({
      statusCode: 403,
      statusMessage: 'No account in context'
    })
  }

  const { passkeyRpId, passkeyOrigin } = useRuntimeConfig(event)

  const verification = await verifyRegistrationResponse({
    response: body,
    expectedChallenge: passkeyReadChallenge(event, body?.challengeToken),
    expectedOrigin: passkeyOrigin,
    expectedRPID: passkeyRpId
  })

  if (!verification.verified) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Registration verification failed'
    })
  }

  // Extract credential data from verification response
  const credential = verification.registrationInfo?.credential
  const credentialPublicKey = credential?.publicKey
  const counter = credential?.counter || 0

  if (!credentialPublicKey) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing credential public key'
    })
  }

  // The id comes from the verified attestation, never the request body
  const credentialId = credential.id
  const publicKey = Buffer.from(credentialPublicKey).toString('base64url')

  // A passkey is one identity across Entu, so its id may only ever stand for one key
  if (typeof credentialId !== 'string' || await passkeyIdTaken(credentialId, publicKey)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Passkey is already registered with another key'
    })
  }

  // Store only essential data: credential ID, public key, counter, device name
  const properties = [{
    type: 'entu_passkey',
    passkey_id: credentialId,
    passkey_public: publicKey,
    passkey_counter: counter,
    passkey_device: typeof body.deviceName === 'string' && body.deviceName.trim() ? body.deviceName.trim().slice(0, 100) : 'Unknown Device'
  }]

  // Clients may not write passkey values, so the verified passkey is stored as the server on the user's own person
  const result = await setEntity({ ...entu, systemUser: true }, entu.user, properties)

  return {
    success: true,
    _id: result._id.toString(),
    properties: result.properties.map((p) => ({
      _id: p._id.toString(),
      type: p.type,
      string: `${p.passkey_device || ''} ${p._id.toString().slice(-4).toUpperCase()}`.trim()
    }))
  }
})
