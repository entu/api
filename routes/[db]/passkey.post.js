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

  const { origin, hostname } = getRequestURL(event)

  try {
    const verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge: body.expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: hostname
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

    // Store only essential data: credential ID, public key, counter, device name
    const properties = [{
      type: 'entu_passkey',
      passkey_id: body.id,
      passkey_public: Buffer.from(credentialPublicKey).toString('base64url'),
      passkey_counter: counter,
      passkey_device: body.deviceName || 'Unknown Device'
    }]

    // Store passkey in current database only
    const result = await setEntity(entu, entu.user, properties)

    return {
      success: true,
      _id: result._id.toString(),
      properties: result.properties.map((p) => ({
        _id: p._id.toString(),
        type: p.type,
        string: `${p.passkey_device || ''} ${p._id.toString().slice(-4).toUpperCase()}`.trim()
      }))
    }
  }
  catch (error) {
    throw createError({
      statusCode: 400,
      statusMessage: error.message || 'Registration failed'
    })
  }
})
