import { verifyAuthenticationResponse } from '@simplewebauthn/server'
import jwt from 'jsonwebtoken'

defineRouteMeta({ openAPI: { hidden: true } })

export default defineEventHandler(async (event) => {
  const body = await event.req.json()
  const { jwtSecret, passkeyRpId, passkeyOrigin } = useRuntimeConfig(event)
  const audience = (getRequestIP(event, { xForwardedFor: true }) || '127.0.0.1').replace('::1', '127.0.0.1')

  const entuDb = await connectDb('entu')
  const dbs = await entuDb.admin().listDatabases()
  const credentialId = body.id

  // Search all tenant databases for the credential in parallel
  const dbMatches = (await Promise.all(
    dbs.databases
      .filter(({ name }) => !mongoDbSystemDbs.includes(name))
      .map(async ({ name: dbName }) => {
        const db = await connectDb(dbName)

        const user = await db.collection('entity').findOne(
          { 'private.entu_passkey.passkey_id': credentialId },
          { projection: { _id: true, 'private.name.string': true, 'private.entu_passkey': true } }
        )

        if (!user?.private?.entu_passkey)
          return null

        const passkeyProp = user.private.entu_passkey.find((pk) => pk.passkey_id === credentialId)
        if (!passkeyProp)
          return null

        return { dbName, db, user, passkeyProp }
      })
  )).filter(Boolean)

  if (dbMatches.length === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Credential not found' })
  }

  // Fetch public key from first matching database
  const { db: firstDb, passkeyProp: firstPasskeyProp } = dbMatches[0]
  const propertyDoc = await firstDb.collection('property').findOne({
    _id: firstPasskeyProp._id,
    type: 'entu_passkey',
    deleted: { $exists: false }
  })

  if (!propertyDoc?.passkey_public) {
    throw createError({ statusCode: 400, statusMessage: 'Public key not found in property document' })
  }

  const authenticatorData = {
    credentialID: Buffer.from(propertyDoc.passkey_id, 'base64url'),
    credentialPublicKey: Buffer.from(propertyDoc.passkey_public, 'base64url'),
    counter: propertyDoc.passkey_counter || 0
  }

  const verification = await verifyAuthenticationResponse({
    response: {
      id: body.id,
      rawId: body.rawId,
      response: body.response,
      type: body.type
    },
    expectedChallenge: body.expectedChallenge,
    expectedOrigin: passkeyOrigin,
    expectedRPID: passkeyRpId,
    credential: {
      id: authenticatorData.credentialID,
      publicKey: authenticatorData.credentialPublicKey,
      counter: authenticatorData.counter
    }
  })

  if (!verification.verified) {
    throw createError({ statusCode: 400, statusMessage: 'Authentication verification failed' })
  }

  const newCounter = verification.authenticationInfo?.newCounter ?? authenticatorData.counter + 1

  // Update counter in all matching databases in parallel
  await Promise.all(
    dbMatches.map(async ({ dbName, db, user }) => {
      await db.collection('property').updateMany(
        { entity: user._id, type: 'entu_passkey', passkey_id: credentialId, deleted: { $exists: false } },
        { $set: { passkey_counter: newCounter } }
      )

      await aggregateEntity({ account: dbName, user: user._id, userStr: user._id.toString(), db }, user._id)
    })
  )

  const accountUsersIds = Object.fromEntries(dbMatches.map(({ dbName, user }) => [dbName, user._id.toString()]))

  return {
    accounts: dbMatches.map(({ dbName, user }) => ({
      _id: dbName,
      name: dbName,
      user: {
        _id: user._id.toString(),
        name: user.private?.name?.at(0)?.string || user._id.toString()
      }
    })),
    token: jwt.sign({ accounts: accountUsersIds }, jwtSecret, { audience, expiresIn: '48h' })
  }
})
