export default defineEventHandler(async (event) => {
  const path = getRoutePath(event)

  if (isContextFreeRoute(event.method, path)) return

  event.context.entu.db = await connectDb(event.context.entu.account)

  // Entu support acts as the database entity while the owner's grant runs - checked on every request, so revoking ends it at once
  event.context.entu = await withSupportAccess(event.context.entu)
})
