// JSON-RPC over streamable HTTP for one database, driven by MCP clients rather than called by hand, so kept out of the API docs
defineRouteMeta({ openAPI: { hidden: true } })

export default defineEventHandler(async (event) => await mcpHandleRequest(event))
