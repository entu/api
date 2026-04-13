import { createYoga } from 'graphql-yoga'

function SANDBOX_HTML (endpoint) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Apollo Sandbox</title>
  <style>* { margin: 0; padding: 0; } html, body { height: 100%; }</style>
</head>
<body>
  <div id="sandbox" style="height:100vh;"></div>
  <script src="https://embeddable-sandbox.cdn.apollographql.com/_latest/embeddable-sandbox.umd.production.min.js"></script>
  <script>
    new window.EmbeddedSandbox({
      target: '#sandbox',
      initialEndpoint: '${endpoint}',
      endpointIsEditable: false
    });
  </script>
</body>
</html>`
}

export default defineEventHandler(async (event) => {
  // Serve Apollo Sandbox for browser requests
  if (event.req.headers.get('accept')?.includes('text/html')) {
    const headers = Object.fromEntries(event.req.headers.entries())
    const host = headers.host || 'localhost'
    const proto = (headers['x-forwarded-proto'] || 'http').split(',')[0].trim()
    const account = formatDatabaseName(event.context.params?.db)
    const { graphqlBasePath } = useRuntimeConfig(event)
    const basePath = (graphqlBasePath || '').replace(/\/$/, '')

    return new Response(SANDBOX_HTML(`${proto}://${host}${basePath}/${account}`), {
      headers: { 'content-type': 'text/html; charset=utf-8' }
    })
  }

  // Handle GraphQL GET requests (introspection etc.)
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
    graphqlEndpoint: `/graphql/${entu.account}`,
    graphiql: false
  })

  const headers = Object.fromEntries(event.req.headers.entries())
  const host = headers.host || 'localhost'
  const proto = (headers['x-forwarded-proto'] || 'http').split(',')[0].trim()
  const rawPath = event.url.pathname + event.url.search
  const url = `${proto}://${host}${rawPath}`

  const request = new Request(url, {
    method: event.req.method,
    headers: new Headers(headers)
  })

  return yoga.fetch(request)
})
