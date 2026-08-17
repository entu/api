defineRouteMeta({ openAPI: { hidden: true } })

export default defineEventHandler(async (event) => {
  const db = getRouterParam(event, 'db')

  return await checkDatabaseName(db)
})
