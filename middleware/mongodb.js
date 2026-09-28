export default defineEventHandler(async (event) => {
  const path = getRoutePath(event)

  if (isContextFreeRoute(event.method, path)) return

  event.context.entu.db = await connectDb(event.context.entu.account)
})
