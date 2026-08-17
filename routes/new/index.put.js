defineRouteMeta({ openAPI: { hidden: true } })

export default defineEventHandler(async (event) => {
  const { entu } = event.context

  if (!entu?.token) {
    throw createError({ statusCode: 401, statusMessage: 'No token' })
  }

  const { uid, provider, name, email } = entu.token.user || {}

  if (!uid || !provider) {
    throw createError({ statusCode: 400, statusMessage: 'Sign in with a provider to create a database' })
  }

  const body = await event.req.json().catch(() => ({}))

  if (typeof body?.database !== 'string' || !body.database) {
    throw createError({ statusCode: 400, statusMessage: 'No database' })
  }

  const { available, reason } = await checkDatabaseName(body.database)

  if (!available) {
    throw createError({
      statusCode: 400,
      statusMessage: reason === 'taken' ? 'Database name taken' : 'Invalid database name'
    })
  }

  const databaseName = body.database

  // Atomic reservation by unique _id so two concurrent creations of the same name cannot share a database
  const entuDb = await connectDb('entu')

  try {
    await entuDb.collection('reservation').insertOne({ _id: databaseName, created: new Date() })
  }
  catch (error) {
    throw error.code === 11000 ? createError({ statusCode: 400, statusMessage: 'Database name taken' }) : error
  }

  try {
    // Re-check existence while holding the reservation to close the race between the earlier check and the insert
    const recheck = await checkDatabaseName(databaseName)

    if (!recheck.available) {
      throw createError({ statusCode: 400, statusMessage: 'Database name taken' })
    }

    const db = await connectDb(databaseName, true)
    const newEntu = { account: databaseName, db, systemUser: true }

    await initializeNewDatabase(newEntu, { name, email, uid, provider })
  }
  finally {
    await entuDb.collection('reservation').deleteOne({ _id: databaseName }).catch(() => {})
  }

  // Token issuance moved to /auth/refresh — the client refreshes to pick up the new database by identity scan.
  return { db: databaseName }
})
