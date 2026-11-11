// Longest support access a database owner may grant at once
const supportMaxDays = 365

// Whether a login identity is Entu support - only a Smart-ID sign-in whose id is listed in NITRO_SUPPORT_USERS
export function isSupportIdentity (user) {
  if (user?.provider !== 'smart-id' || typeof user.uid !== 'string' || !user.uid) {
    return false
  }

  // String() because Nitro parses an all-digit env value into a number
  const { supportUsers } = useRuntimeConfig()

  return String(supportUsers || '').split(',').map((x) => x.trim()).includes(user.uid)
}

// The database entity's id and support grant end, while the owner's grant is still running
export async function getSupportGrant (db) {
  if (!db) return

  // The oldest database entity is the real one, as in setupDatabase - a later entity of that type can't grant access
  const database = await db.collection('entity').findOne(
    { 'private._type.string': 'database', _origin_db: { $exists: false } },
    { projection: { _id: true, 'private.support_until.datetime': true }, sort: { _id: 1 } }
  )

  const until = database?.private?.support_until?.at(0)?.datetime

  if (!until || new Date(until).getTime() <= Date.now()) return

  return { databaseId: database._id, until: new Date(until) }
}

// Databases with a running support grant for a support identity, leaving out those it is a person in - { account, databaseId, until } entries
export async function findSupportAccounts (identity, ownAccounts = [], onlyForAccounts = []) {
  if (!isSupportIdentity(identity)) {
    return []
  }

  const connection = await connectDb('entu')
  const dbs = await connection.admin().listDatabases()

  const results = await Promise.all(
    dbs.databases
      .filter(({ name: account }) => !mongoDbSystemDbs.includes(account) && !ownAccounts.includes(account) && (onlyForAccounts.length === 0 || onlyForAccounts.includes(account)))
      .map(async ({ name: account }) => {
        const grant = await getSupportGrant(await connectDb(account))

        return grant ? { account, databaseId: grant.databaseId, until: grant.until } : null
      })
  )

  return results.filter(Boolean).toSorted((a, b) => a.account.localeCompare(b.account))
}

// Lets Entu support act as the database entity while the owner's grant runs - only for an IP-bound webapp or app token with no person of its own here
export async function withSupportAccess (entu) {
  // An OAuth client's token names no address, so it never carries support access to its servers
  if (entu.user || !entu.token?.aud || !isSupportIdentity(entu.token?.user)) {
    return entu
  }

  const grant = await getSupportGrant(entu.db)

  if (!grant) {
    return entu
  }

  const supportEntu = { ...entu, user: grant.databaseId, userStr: grant.databaseId.toString(), support: entu.token.user.uid }

  logger('Support access', supportEntu)

  return supportEntu
}

// Support may not touch logins, automatic user creation or its own grant, and only an entity's _owner may grant or end support access
export function checkSupportTypes (entu, types, isOwner) {
  if (entu.systemUser) return

  if (entu.support && types.some((type) => isCredentialType(type) || ['add_user', 'support_until'].includes(type))) {
    throw createError({ statusCode: 403, statusMessage: 'Entu support can\'t change logins or support access' })
  }

  if (types.includes('support_until') && !isOwner) {
    throw createError({ statusCode: 403, statusMessage: 'User not in _owner property' })
  }
}

// A support grant ends in the future and at most supportMaxDays from now
export function validateSupportUntil (properties) {
  for (const property of properties) {
    if (property.type !== 'support_until') continue

    const until = new Date(property.datetime).getTime()

    if (Number.isNaN(until) || until <= Date.now() || until > Date.now() + supportMaxDays * 24 * 60 * 60 * 1000) {
      throw createError({ statusCode: 400, statusMessage: `Property support_until must be a datetime within the next ${supportMaxDays} days` })
    }
  }
}
