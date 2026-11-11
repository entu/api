// RFC 9728 discovery document for the multi-database MCP endpoint - fetched by MCP clients, not called by hand, so kept out of the API docs
defineRouteMeta({ openAPI: { hidden: true } })

export default defineEventHandler((event) => {
  // No database in the resource, so the user picks databases after signing in
  return {
    resource: oauthBaseUrl(event),
    authorization_servers: [oauthApiUrl(event)],
    bearer_methods_supported: ['header']
  }
})
