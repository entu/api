import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import jwt from 'jsonwebtoken'

const schemaResourceUri = 'entu://schema'

// Creates an MCP server bound to one request's Entu context - every tool and resource runs as the calling user
export async function createMcpServer (entu) {
  const { commitHash } = useRuntimeConfig()

  const server = new Server({
    name: 'entu',
    version: commitHash || 'dev'
  }, {
    capabilities: { resources: {}, tools: {} },
    instructions: await aiPrompt('mcp')
  })

  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: toolDefinitions() }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    // Tool failures are returned to the model rather than thrown, so it can correct itself instead of losing the turn
    try {
      const result = await executeTool(entu, request.params.name, request.params.arguments)

      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    }
    catch (e) {
      return {
        content: [{ type: 'text', text: e.statusMessage || e.message || String(e) }],
        isError: true
      }
    }
  })

  server.setRequestHandler(ListResourcesRequestSchema, () => ({
    resources: [{
      uri: schemaResourceUri,
      name: `${entu.account} schema`,
      description: 'Entity types and their property definitions in this database',
      mimeType: 'text/markdown'
    }]
  }))

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    if (request.params.uri !== schemaResourceUri) {
      throw createError({ statusCode: 404, statusMessage: `Unknown resource ${request.params.uri}` })
    }

    return {
      contents: [{
        uri: schemaResourceUri,
        mimeType: 'text/markdown',
        text: await aiRenderConfiguration(entu)
      }]
    }
  })

  return server
}

// Read tools derived from the shared AI tool definitions, so the built-in assistant and MCP cannot drift apart.
// Every one of them only reads, which the annotations say out loud - without them a client files the whole server
// under "other tools" and cannot tell a caller that nothing here changes their data.
function toolDefinitions () {
  return aiToolDefinitions
    .filter((tool) => aiReadToolNames.includes(tool.function.name))
    .map((tool) => ({
      name: tool.function.name,
      description: tool.function.description,
      inputSchema: tool.function.parameters,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false
      }
    }))
}

// Executes a tool as the calling user - rights filtering is inherited from the entu context
async function executeTool (entu, name, args) {
  if (!aiReadToolNames.includes(name)) {
    throw createError({ statusCode: 400, statusMessage: `Unknown tool ${name}` })
  }

  return await aiExecuteReadTool(entu, name, args || {})
}
