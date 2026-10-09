// Signs the invite an entu_user value holds until someone accepts it - valid 24 hours, for this one person
export function inviteCreate (entu, entityId) {
  return tokenSign(undefined, 'invite', { db: entu.account, entityId: entityId.toString() }, { expiresIn: '24h' })
}

// Checks an invite token and finds the pending value holding it - `property` is missing once the invite was used or cancelled
export async function inviteVerify (event, token) {
  const payload = tokenVerify(event, 'invite', token, { legacy: true })

  if (typeof payload?.db !== 'string' || typeof payload?.entityId !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'Invalid or expired invite' })
  }

  const account = formatDatabaseName(payload.db)
  const db = await connectDb(account)

  const person = await db.collection('entity').findOne(
    { _id: getObjectId(payload.entityId), 'auth.user.invite': token },
    { projection: { 'private.name.string': true, 'auth.user': true } }
  )

  return {
    account,
    entityId: payload.entityId,
    personName: person?.private?.name?.at(0)?.string,
    property: person?.auth?.user?.find((u) => u.invite === token)
  }
}

// Links the signed-in identity to the invited person; returns the account it opens, or `conflict` when the identity is another person there
export async function inviteAccept (invite, identity, accounts) {
  const existing = accounts.find((a) => a.account === invite.account)

  if (existing && existing.userId.toString() !== invite.entityId) {
    return { conflict: true }
  }

  // A used or cancelled invite still signs in the person it was for, but opens nothing for anyone else
  if (!invite.property && !existing) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid or expired invite' })
  }

  if (invite.property) {
    const entu = { account: invite.account, db: await connectDb(invite.account), systemUser: true }

    await setEntity(entu, getObjectId(invite.entityId), [{ ...authCredentialProperty(identity), _id: invite.property._id }])
  }

  if (existing) {
    return {}
  }

  return { account: { account: invite.account, userId: invite.entityId, userName: invite.personName } }
}
