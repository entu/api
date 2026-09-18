import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import jwt from 'jsonwebtoken'

const schemaResourceUri = 'entu://schema'

// Builds the Entu context for MCP requests, which the auth and mongodb middleware skip - the token is optional, as on the REST API
export async function buildMcpContext (event) {
  const { jwtSecret } = useRuntimeConfig(event)
  const account = formatDatabaseName(event.context.params?.db)

  if (!account) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid account parameter' })
  }

  const entu = {
    ip: (getRequestIP(event, { xForwardedFor: true }) || '127.0.0.1').replace('::1', '127.0.0.1'),
    account
  }

  const tokenStr = (event.req.headers.get('authorization') || '').replace('Bearer ', '').trim()

  if (tokenStr) {
    try {
      entu.token = jwt.verify(tokenStr, jwtSecret)

      // Only verify audience if token contains it (for IP-restricted tokens)
      if (entu.token.aud && entu.token.aud !== entu.ip) {
        throw new Error('Invalid JWT audience')
      }
      if (entu.token.accounts?.[account]) {
        entu.user = getObjectId(entu.token.accounts[account])
        entu.userStr = entu.token.accounts[account]
      }
      if (entu.token.user?.email) {
        entu.email = entu.token.user.email
      }
    }
    catch (e) {
      throw createError({ statusCode: 401, statusMessage: e.message || String(e) })
    }
  }

  entu.db = await connectDb(account)

  return entu
}

// Creates an MCP server bound to one request's Entu context - every tool and resource runs as the calling user
export async function createMcpServer (entu) {
  const { appUrl, commitHash } = useRuntimeConfig()

  const server = new Server({
    name: 'entu',
    version: commitHash || 'dev'
  }, {
    capabilities: { resources: {}, tools: {} },
    instructions: (await aiPrompt('mcp')).replaceAll('{{entityUrl}}', () => `${appUrl}/${entu.account}`)
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

// Read tools from the shared AI definitions, annotated read-only so clients know nothing here changes data
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
