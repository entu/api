import { createYoga } from 'graphql-yoga'

export default defineEventHandler(async (event) => {
  let entu
  try {
    entu = await buildEntuContext(event)
  }
  catch (e) {
    return new Response(JSON.stringify({
      errors: [{ message: e.statusMessage || e.message }]
    }), {
      status: e.statusCode || 500,
      headers: { 'content-type': 'application/json' }
    })
  }

  const schema = await getOrBuildSchema(entu)

  const yoga = createYoga({
    schema,
    context: { entu },
    graphqlEndpoint: `/graphql/${entu.account}`
  })

  const headers = Object.fromEntries(event.req.headers.entries())
  const host = headers.host || 'localhost'
  const proto = (headers['x-forwarded-proto'] || 'http').split(',')[0].trim()
  const rawPath = event.url.pathname + event.url.search
  const url = `${proto}://${host}${rawPath}`

  const body = await event.req.text()

  const request = new Request(url, {
    method: event.req.method,
    headers: new Headers(headers),
    body: body ?? undefined
  })

  return yoga.fetch(request)
})
