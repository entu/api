export default defineEventHandler(async (event) => {
  if (event.path === '/')
    return
  if (event.path === '/docs' || event.path.startsWith('/docs/'))
    return
  if (event.path.startsWith('/_openapi'))
    return
  if (event.path.startsWith('/new'))
    return
  if (event.path.startsWith('/openapi'))
    return
  if (event.path.startsWith('/stripe'))
    return

  event.context.entu.db = await connectDb(event.context.entu.account)
})
