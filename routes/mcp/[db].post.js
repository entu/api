import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'

// JSON-RPC over streamable HTTP, driven by MCP clients rather than called by hand, so kept out of the API docs
defineRouteMeta({ openAPI: { hidden: true } })

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

  const server = await createMcpServer(entu)

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
