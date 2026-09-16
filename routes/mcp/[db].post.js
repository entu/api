import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'

defineRouteMeta({
  openAPI: {
    tags: ['MCP'],
    summary: 'MCP endpoint',
    description: 'Model Context Protocol (streamable HTTP) endpoint for one database. Exposes the read tools and the entu://schema resource to external AI agents. A JWT in the `Authorization: Bearer <token>` header is optional - without it only public entities are readable, with it everything that user may see.',
    parameters: [
      {
        name: 'db',
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description: 'Database name'
      }
    ],
    responses: {
      200: { description: 'JSON-RPC response' },
      400: { description: 'Invalid account parameter' },
      401: { description: 'Invalid token' }
    }
  }
})

export default defineEventHandler(async (event) => {
  let entu

  try {
    entu = await buildMcpContext(event)
  }
  catch (e) {
    // Point rejected clients at the protected resource metadata so they can start the OAuth flow (RFC 9728)
    if (e.statusCode === 401) {
      const account = formatDatabaseName(event.context.params?.db)

      setResponseHeader(event, 'www-authenticate', `Bearer resource_metadata="${oauthBaseUrl(event)}/.well-known/oauth-protected-resource/${account}"`)
    }

    throw e
  }

  const server = createMcpServer(entu)

  // Stateless - each request carries its own credentials, so any API replica can serve any request
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true })

  await server.connect(transport)

  try {
    return await transport.handleRequest(event.req)
  }
  finally {
    await server.close()
  }
})
