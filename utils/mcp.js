import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { CallToolRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const schemaResourcePattern = /^entu:\/\/([^/]+)\/schema$/

// Readable tool names MCP clients show in tool lists and permission prompts - MCP-only, so they stay out of the shared AI definitions
const toolTitles = {
  get_entity_type: 'Get entity type',
  search_entities: 'Search entities',
  get_entity: 'Get entity',
  get_entity_history: 'Get entity history',
  get_file_url: 'Get file link'
}

// Serves one MCP request - POST /mcp/<db> reaches that database, POST /mcp the databases the token was given at sign-in
export async function mcpHandleRequest (event) {
  const account = formatDatabaseName(event.context.params?.db)

  let accounts

  try {
    accounts = mcpAccounts(event, account)
  }
  catch (e) {
    // Point rejected clients at the protected resource metadata so they can start the OAuth flow (RFC 9728)
    if (e.statusCode === 401) {
      const metadataPath = account ? `/.well-known/oauth-protected-resource/${account}` : '/.well-known/oauth-protected-resource'

      setResponseHeader(event, 'www-authenticate', `Bearer resource_metadata="${oauthBaseUrl(event)}${metadataPath}"`)
    }

    throw e
  }

  const server = await createMcpServer(event, accounts)

  // Stateless - each request carries its own credentials, so any API replica can serve any request
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true })

  await server.connect(transport)

  try {
    return await transport.handleRequest(event.req)
  }
  finally {
    await server.close()
  }
}

// The databases this request's tools may name - the one in the URL, where the token is optional as on the REST API, or every database in the token
function mcpAccounts (event, account) {
  const { token } = authReadToken(event)

  if (account) {
    return [account]
  }

  const accounts = Object.keys(token?.accounts || {}).toSorted()

  if (accounts.length === 0) {
    throw createError({ statusCode: 401, statusMessage: 'Sign in to connect databases' })
  }

  return accounts
}

// The Entu context for one call, as the calling user in the database it names - never through withSupportAccess, so support access never reaches MCP
async function databaseContext (event, accounts, account) {
  if (!accounts.includes(account)) {
    throw createError({ statusCode: 400, statusMessage: `Unknown database ${account} - use one of ${accounts.join(', ')}` })
  }

  return { ...authReadToken(event, account), account, db: await connectDb(account) }
}

// Creates an MCP server for one request - every tool and resource runs as the calling user in the database the call names
async function createMcpServer (event, accounts) {
  const { appUrl, commitHash } = useRuntimeConfig()

  // Clients that support server metadata (MCP serverInfo) show this title, description, website and the Entu logo from the webapp next to the connector
  const server = new Server({
    name: 'entu',
    title: 'Entu',
    description: 'Read your Entu databases - search entities, read their properties, history and files, with your own rights.',
    websiteUrl: 'https://entu.ee',
    version: commitHash || 'dev',
    icons: [
      { src: `${appUrl}/logo.svg`, mimeType: 'image/svg+xml' },
      { src: `${appUrl}/logo.png`, mimeType: 'image/png' }
    ]
  }, {
    capabilities: { resources: {}, tools: {} },
    instructions: (await aiPrompt('mcp')).replaceAll('{{entityUrl}}', () => `${appUrl}/{db}`)
  })

  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: toolDefinitions(accounts) }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    // Tool failures are returned to the model rather than thrown, so it can correct itself instead of losing the turn
    try {
      const { db, ...args } = request.params.arguments || {}
      const result = await executeTool(await databaseContext(event, accounts, db), request.params.name, args)

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
    resources: accounts.map((account) => ({
      uri: `entu://${account}/schema`,
      name: `${account} schema`,
      title: `${account} schema`,
      description: `Entity types and their property definitions in the ${account} database`,
      mimeType: 'text/markdown'
    }))
  }))

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const account = request.params.uri.match(schemaResourcePattern)?.at(1)

    if (!account) {
      throw createError({ statusCode: 404, statusMessage: `Unknown resource ${request.params.uri}` })
    }

    return {
      contents: [{
        uri: request.params.uri,
        mimeType: 'text/markdown',
        text: await aiRenderConfiguration(await databaseContext(event, accounts, account))
      }]
    }
  })

  return server
}

// Read tools from the shared AI definitions with a required `db` argument, annotated read-only so clients know nothing here changes data
function toolDefinitions (accounts) {
  return aiToolDefinitions
    .filter((tool) => aiReadToolNames.includes(tool.function.name))
    .map((tool) => ({
      name: tool.function.name,
      title: toolTitles[tool.function.name],
      description: tool.function.description,
      inputSchema: {
        ...tool.function.parameters,
        properties: {
          db: { type: 'string', enum: accounts, description: 'Database to read' },
          ...tool.function.parameters.properties
        },
        required: ['db', ...(tool.function.parameters.required || [])]
      },
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

  return await aiExecuteReadTool(entu, name, args)
}
