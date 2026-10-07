import { generateRegistrationOptions } from '@simplewebauthn/server'

defineRouteMeta({ openAPI: { hidden: true } })

export default defineEventHandler(async (event) => {
  const entu = event.context.entu

  if (!entu.user) {
    throw createError({
      statusCode: 403,
      statusMessage: 'No user'
    })
  }

  if (!entu.userStr) {
    throw createError({
      statusCode: 403,
      statusMessage: 'No user ID'
    })
  }

  if (!entu.token?.accounts) {
    throw createError({
      statusCode: 403,
      statusMessage: 'No accounts in token'
    })
  }

  // Fetch user entity to get email/name and the passkeys it already has
  const db = await connectDb(entu.account)
  const user = await db.collection('entity').findOne(
    { _id: entu.user },
    { projection: { 'private.email.string': 1, 'private.name.string': 1, 'private.entu_passkey.passkey_id': 1 } }
  )

  // A passkey signs in to all of Entu, so it is labelled with the person only - never the database
  const userName = user?.private?.name?.at(0)?.string || user?.private?.email?.at(0)?.string || entu.userStr

  const { passkeyRpId } = useRuntimeConfig(event)

  const options = await generateRegistrationOptions({
    rpName: 'Entu',
    rpID: passkeyRpId,
    userID: Buffer.from(entu.userStr, 'utf8'),
    userName,
    excludeCredentials: (user?.private?.entu_passkey || []).filter((p) => p.passkey_id).map((p) => ({ id: p.passkey_id })),
    authenticatorSelection: {
      userVerification: 'preferred',
      residentKey: 'preferred'
    },
    supportedAlgorithmIDs: [-7, -257] // ES256, RS256
  })

  return { ...options, challengeToken: passkeySignChallenge(event, options.challenge) }
})
