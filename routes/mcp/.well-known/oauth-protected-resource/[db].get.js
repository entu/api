// RFC 9728 discovery document - fetched by MCP clients, not called by hand, so kept out of the API docs
defineRouteMeta({ openAPI: { hidden: true } })

export default defineEventHandler((event) => {
  const base = oauthBaseUrl(event)
  const account = formatDatabaseName(event.context.params?.db)

  if (!account) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid account parameter' })
  }

  // The resource lives on this host (mcp.entu.app), but Entu's authorization server is the API itself
  return {
    resource: `${base}/${account}`,
    authorization_servers: [oauthApiUrl(event)],
    bearer_methods_supported: ['header']
  }
})
