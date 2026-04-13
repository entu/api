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

  try {
    // Fetch user entity to get email/name
    const db = await connectDb(entu.account)
    const user = await db.collection('entity').findOne(
      { _id: entu.user },
      { projection: { 'private.email.string': 1, 'private.name.string': 1 } }
    )

    // Use email if available, otherwise fall back to user ID
    const userName = user?.private?.name?.at(0)?.string || user?.private?.email?.at(0)?.string || entu.userStr

    const { hostname } = getRequestURL(event)

    const options = await generateRegistrationOptions({
      rpName: 'Entu',
      rpID: hostname,
      userID: Buffer.from(entu.userStr, 'utf8'),
      userName: `${userName} - ${entu.userStr}@${entu.account}`,
      authenticatorSelection: {
        userVerification: 'preferred',
        residentKey: 'preferred'
      },
      supportedAlgorithmIDs: [-7, -257] // ES256, RS256
    })

    return options
  }
  catch (error) {
    throw createError({
      statusCode: 500,
      statusMessage: error.message || 'Failed to generate registration options'
    })
  }
})
