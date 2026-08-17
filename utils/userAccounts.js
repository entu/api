// Scans all account databases for person entities matching the given identity (API key hash, or OAuth uid+provider with legacy email fallback) and returns the accessible accounts
export async function findUserAccounts ({ apiKeyHash, uid, provider, email } = {}, onlyForAccount) {
  // Harden Mongo filters: only scalar strings may reach the queries — anything else counts as absent
  apiKeyHash = typeof apiKeyHash === 'string' ? apiKeyHash : undefined
  uid = typeof uid === 'string' ? uid : undefined
  provider = typeof provider === 'string' ? provider : undefined
  email = typeof email === 'string' ? email : undefined

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
            { 'private.entu_api_key.string': apiKeyHash },
            { projection: { _id: true, 'private.name.string': true } }
          )
        }
        else {
          // Step 1: new format — find by uid + provider
          if (uid && provider) {
            person = await accountCon.collection('entity').findOne(
              { 'private.entu_user': { $elemMatch: { uid, provider } } },
              { projection: { _id: true, 'private.name.string': true } }
            )
          }

          // Step 2: old format — find by email string and migrate on first match
          if (!person && email) {
            const oldPerson = await accountCon.collection('entity').findOne(
              { 'private.entu_user.string': email },
              { projection: { _id: true, 'private.name.string': true, 'private.entu_user': true } }
            )

            if (oldPerson) {
              const oldProp = oldPerson.private?.entu_user?.find((u) => u.string === email)

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

        return { account, userId: person._id, userName: person.private?.name?.at(0)?.string || person._id.toString() }
      })
  )

  return results.filter(Boolean)
}
