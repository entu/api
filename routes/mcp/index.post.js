// JSON-RPC over streamable HTTP for the databases the user shared at sign-in, driven by MCP clients rather than called by hand, so kept out of the API docs
defineRouteMeta({ openAPI: { hidden: true } })

export default defineEventHandler(async (event) => await mcpHandleRequest(event))
