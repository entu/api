export default defineNitroPlugin(async () => {
  const { runAggregation } = useRuntimeConfig()

  // Rides the same single-worker flag as aggregation, so only one instance runs sweeps
  while (runAggregation) {
    await share()
    await new Promise((resolve) => setTimeout(resolve, 10000))
  }
})

async function share () {
  const db = await connectDb('entu')
  const mongoDatabases = await db.admin().listDatabases()
  const databases = mongoDatabases.databases
    .filter((db) => !['admin', 'analytics', 'config', 'local'].includes(db.name))
    .map((db) => db.name)

  await Promise.all(databases.map(shareDb))
}

async function shareDb (database) {
  try {
    await syncMirrors(database)
  }
  catch (error) {
    loggerError(`Sharing sync failed: ${error.message}`, { account: database })
  }
}
