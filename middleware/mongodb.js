export default defineEventHandler(async (event) => {
  const path = event.path.split('?').at(0)

  if (path === '/') return
  if (path === '/_openapi.json') return
  if (path.startsWith('/.well-known/')) return
  if (path === '/docs' || path.startsWith('/docs/')) return
  if (path === '/graphql' || path.startsWith('/graphql/')) return
  if (path === '/new' || path.startsWith('/new/')) return
  if (path === '/openapi' || path.startsWith('/openapi/')) return
  if (path === '/stripe' || path.startsWith('/stripe/')) return

  event.context.entu.db = await connectDb(event.context.entu.account)
})
