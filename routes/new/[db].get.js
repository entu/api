// Internal to the Entu webapp signup - public check whether a name is free for a new database
defineRouteMeta({ openAPI: { hidden: true } })

export default defineEventHandler(async (event) => {
  const db = getRouterParam(event, 'db')

  return await checkDatabaseName(db)
})
