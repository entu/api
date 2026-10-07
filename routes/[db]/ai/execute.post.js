// Internal to the Entu webapp and app - applies a confirmed AI chat proposal with the caller's rights
defineRouteMeta({ openAPI: { hidden: true } })

export default defineEventHandler(async (event) => {
  const entu = event.context.entu

  if (!entu.user) {
    throw createError({
      statusCode: 403,
      statusMessage: 'No user'
    })
  }

  const body = await event.req.json()

  aiValidateOperations(body?.operations)

  return await aiExecuteOperations(entu, body.operations)
})
