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

  const body = await event.req.json()

  if (typeof body.database !== 'string' || !body.database) {
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
  const db = await connectDb(databaseName, true)
  const newEntu = { account: databaseName, db, systemUser: true }

  try {
    await initializeNewDatabase(newEntu, { name, email, uid, provider })
  }
  catch (error) {
    // Drop the half-created database so the name is not burned
    await db.dropDatabase().catch(() => {})

    throw error
  }

  // Token issuance moved to /auth/refresh — the client refreshes to pick up the new database by identity scan.
  return { db: databaseName }
})
