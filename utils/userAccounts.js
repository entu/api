// Scans all account databases for person entities matching the given identity (API key hash, passkey id + key, or OAuth uid+provider with legacy email fallback) and returns { account, userId, userName } entries
export async function findUserAccounts ({ apiKeyHash, uid, provider, email, passkeyPublic } = {}, onlyForAccount) {
  // Harden Mongo filters: only scalar strings may reach the queries — anything else counts as absent
  apiKeyHash = typeof apiKeyHash === 'string' ? apiKeyHash : undefined
  uid = typeof uid === 'string' ? uid : undefined
  provider = typeof provider === 'string' ? provider : undefined
  email = typeof email === 'string' ? email : undefined
  passkeyPublic = typeof passkeyPublic === 'string' ? passkeyPublic : undefined

  // A passkey is only its id together with the key it was verified with - the id alone can be registered by anyone
  if (provider === 'passkey' && !(uid && passkeyPublic)) {
    return []
  }

  if (!apiKeyHash && !(uid && provider) && !email) {
    return []
  }

  const connection = await connectDb('entu')
  const dbs = await connection.admin().listDatabases()

  const results = await Promise.all(
    dbs.databases
      .filter(({ name: account }) => !mongoDbSystemDbs.includes(account) && (!onlyForAccount || onlyForAccount === account))
      .map(async ({ name: account }) => {
        const accountCon = await connectDb(account)
        let person

        if (apiKeyHash) {
          person = await accountCon.collection('entity').findOne(
            { 'auth.api.string': apiKeyHash },
            { projection: { _id: true, 'private.name.string': true } }
          )
        }
        else {
          // Step 1: new format — find by uid + provider, and a passkey also by the key it was verified with
          if (uid && provider) {
            person = await accountCon.collection('entity').findOne(
              { 'auth.user': { $elemMatch: { uid, provider, ...(provider === 'passkey' ? { passkey_public: passkeyPublic } : {}) } } },
              { projection: { _id: true, 'private.name.string': true } }
            )
          }

          // Step 2: old format — a login holding only its email, which aggregation marks `legacy`; migrated on first match
          if (!person && email) {
            const oldPerson = await accountCon.collection('entity').findOne(
              { 'auth.user': { $elemMatch: { email, legacy: true } } },
              { projection: { _id: true, 'private.name.string': true, 'auth.user': true } }
            )

            if (oldPerson) {
              const oldProp = oldPerson.auth?.user?.find((u) => u.email === email && u.legacy)

              if (oldProp && uid && provider) {
                await setEntity(
                  { account, db: accountCon, systemUser: true },
                  oldPerson._id,
                  [{ type: 'entu_user', _id: oldProp._id, uid, email, provider }]
                )
              }

              person = oldPerson
            }
          }
        }

        if (!person) {
          return null
        }

        // The person's own name, if any - authIssueToken falls back to the id where a name must be shown
        return { account, userId: person._id, userName: person.private?.name?.at(0)?.string }
      })
  )

  return results.filter(Boolean)
}
