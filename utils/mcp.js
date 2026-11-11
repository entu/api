import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { CallToolRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const schemaResourcePattern = /^entu:\/\/([^/]+)\/schema$/

// MCP Apps view that clients supporting the extension render under every write - the change card in assets/mcp/change.html
const changeViewUri = 'ui://entu/change.html'
const changeViewMimeType = 'text/html;profile=mcp-app'

// Readable tool names MCP clients show in tool lists and permission prompts - MCP-only, so they stay out of the shared AI definitions
const toolTitles = {
  get_entity_type: 'Get entity type',
  search_entities: 'Search entities',
  get_entity: 'Get entity',
  get_entity_history: 'Get entity history',
  get_file_url: 'Get file link',
  create_entity_type: 'Create entity type',
  create_property_definition: 'Create property definition',
  create_entity: 'Create entity',
  update_entity: 'Change entity',
  delete_entity: 'Delete entity',
  delete_property: 'Delete property value'
}

// Hints for MCP clients - every write is marked destructive, creates included, so clients ask before each call instead of auto-approving
const readAnnotations = { readOnlyHint: true, idempotentHint: true, openWorldHint: false }
const repeatableWriteAnnotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
const deleteAnnotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }
const writeAnnotations = {
  create_entity_type: repeatableWriteAnnotations,
  create_property_definition: repeatableWriteAnnotations,
  create_entity: repeatableWriteAnnotations,
  update_entity: repeatableWriteAnnotations,
  delete_entity: deleteAnnotations,
  delete_property: deleteAnnotations
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

// The databases where the token names a user - only there are write tools offered, so anonymous connections stay read-only
function mcpWritableAccounts (event, accounts) {
  const { token } = authReadToken(event)

  return accounts.filter((account) => token?.accounts?.[account])
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
    description: 'Read and change your Entu databases - search entities, read their properties, history and files, and create, change or delete entities, with your own rights.',
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

  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: toolDefinitions(accounts, mcpWritableAccounts(event, accounts)) }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    // Tool failures are returned to the model rather than thrown, so it can correct itself instead of losing the turn
    try {
      const { db, ...args } = request.params.arguments || {}
      const result = await executeTool(await databaseContext(event, accounts, db), request.params.name, args)
      const content = [{ type: 'text', text: JSON.stringify(result) }]

      // Write results also go out as structuredContent, which the change view renders as is
      return writeAnnotations[request.params.name] ? { content, structuredContent: result } : { content }
    }
    catch (e) {
      return {
        content: [{ type: 'text', text: e.statusMessage || 'Tool failed' }],
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
    if (request.params.uri === changeViewUri) {
      return {
        contents: [{
          uri: changeViewUri,
          mimeType: changeViewMimeType,
          text: await useStorage('assets:server').getItem('mcp/change.html'),
          // No csp entry - the view loads nothing external and opens links through the host
          _meta: { ui: { prefersBorder: true } }
        }]
      }
    }

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

// Tools from the shared AI definitions with a required `db` argument - read tools for every database, write tools only for those with a signed-in user
function toolDefinitions (accounts, writableAccounts) {
  return aiToolDefinitions
    .filter((tool) => aiReadToolNames.includes(tool.function.name) || writableAccounts.length > 0)
    .map((tool) => {
      const isRead = aiReadToolNames.includes(tool.function.name)

      return {
        name: tool.function.name,
        title: toolTitles[tool.function.name],
        description: tool.function.description,
        inputSchema: {
          ...tool.function.parameters,
          properties: {
            db: isRead
              ? { type: 'string', enum: accounts, description: 'Database to read' }
              : { type: 'string', enum: writableAccounts, description: 'Database to change' },
            ...tool.function.parameters.properties
          },
          required: ['db', ...(tool.function.parameters.required || [])]
        },
        annotations: isRead ? readAnnotations : writeAnnotations[tool.function.name],
        // Both the current and the deprecated MCP Apps key, as the official SDK writes them
        ...(isRead ? {} : { _meta: { ui: { resourceUri: changeViewUri }, 'ui/resourceUri': changeViewUri } })
      }
    })
}

// Executes a tool as the calling user - reads run directly, each write runs at once as a batch of one, since the client confirms every call
async function executeTool (entu, name, args) {
  if (aiReadToolNames.includes(name)) {
    return await aiExecuteReadTool(entu, name, args)
  }

  if (!writeAnnotations[name]) {
    throw createError({ statusCode: 400, statusMessage: `Unknown tool ${name}` })
  }

  if (!entu.user) {
    throw createError({ statusCode: 403, statusMessage: 'Sign in to change data' })
  }

  const operation = { op: name, params: args }

  aiValidateOperations([operation])

  // Read before writing, but report only after the write succeeded - its rights checks are what entitle the caller to see this
  const before = await readBeforeWrite(entu, name, args)
  const { results, error } = await aiExecuteOperations(entu, [operation])

  if (error) {
    throw createError({ statusCode: error.statusCode, statusMessage: error.statusMessage })
  }

  const entityId = results.at(0)?._id ?? before.entityId
  const isEntityDelete = name === 'delete_entity'
  const entity = isEntityDelete ? before.entity : await entitySummary(entu, entityId)
  const labels = await definitionLabels(entu, entity?.typeId)

  return {
    action: writeAction(name),
    database: entu.account,
    _id: entityId,
    type: entity?.type,
    typeLabel: labels.type,
    name: entity?.name,
    description: aiDescribeOperation(operation),
    changes: sortChanges(writeChanges(name, args, before.values), labels.properties),
    url: entityId && !isEntityDelete ? `${useRuntimeConfig().appUrl}/${entu.account}/${entityId}` : undefined
  }
}

// The entity type's label and its property definitions' labels in every language, as far as the caller may read them - the change view shows these instead of names
async function definitionLabels (entu, typeId) {
  if (!typeId) {
    return { properties: new Map() }
  }

  const [typeEntity, propertyEntities] = await Promise.all([
    entu.db.collection('entity').findOne({ _id: typeId, access: accessFilter(entu) }, { projection: { _id: false, 'private.label': true } }),
    entu.db.collection('entity').find({
      'private._parent.reference': typeId,
      'private._type.string': 'property',
      access: accessFilter(entu)
    }, {
      projection: { _id: false, 'private.name.string': true, 'private.label': true, 'private.ordinal.number': true }
    }).toArray()
  ])

  return {
    type: labelValues(typeEntity?.private?.label),
    properties: new Map(propertyEntities.map((property) => [property.private?.name?.at(0)?.string, {
      label: labelValues(property.private?.label),
      ordinal: property.private?.ordinal?.at(0)?.number
    }]))
  }
}

// Adds each change's property label and orders them like the webapp's edit form - by definition ordinal (missing last), then name, keeping a property's values together
function sortChanges (changes, definitions) {
  if (!changes) return

  return changes
    .map((change) => ({ ...change, label: definitions.get(change.property)?.label }))
    .toSorted((a, b) => definitionOrdinal(definitions, a.property) - definitionOrdinal(definitions, b.property) || a.property.localeCompare(b.property))
}

// A property definition's ordinal, or last when it has none or the caller can't read the definition
function definitionOrdinal (definitions, property) {
  return definitions.get(property)?.ordinal ?? Number.MAX_SAFE_INTEGER
}

// Reduces label values to { string, language } pairs, or undefined when there are none
function labelValues (values) {
  const labels = values?.filter((value) => value.string).map((value) => ({ string: value.string, language: value.language }))

  return labels?.length ? labels : undefined
}

// What a write did to its entity, for the change view's header
function writeAction (name) {
  if (name.startsWith('create_')) {
    return 'created'
  }
  if (name === 'delete_entity') {
    return 'deleted'
  }

  return 'changed'
}

// Collects what the write will replace or remove while it still exists - the deleted entity, or the old values by id
async function readBeforeWrite (entu, name, args) {
  switch (name) {
    case 'update_entity': {
      const valueIds = args.properties.filter((property) => property.valueId).map((property) => getObjectId(property.valueId))

      return { values: await propertyRecords(entu, { _id: { $in: valueIds }, entity: getObjectId(args._id) }) }
    }
    case 'delete_entity':
      return { entityId: args._id, entity: await entitySummary(entu, args._id) }
    case 'delete_property': {
      const values = await propertyRecords(entu, { _id: getObjectId(args._id) })

      return { entityId: values.get(args._id)?.entity?.toString(), values }
    }
    default:
      return {}
  }
}

// Live property records matching the filter, keyed by their id
async function propertyRecords (entu, filter) {
  const records = await entu.db.collection('property').find({ ...filter, deleted: { $exists: false } }, {
    projection: { entity: true, type: true, language: true, string: true, number: true, boolean: true, reference: true, date: true, datetime: true, filename: true }
  }).toArray()

  return new Map(records.map((record) => [record._id.toString(), record]))
}

// An entity's type and name, so the user sees what a write touched instead of a bare id - typeId stays server-side for the label lookup
async function entitySummary (entu, entityId) {
  if (!entityId) return

  const entity = await entu.db.collection('entity').findOne({ _id: getObjectId(entityId) }, {
    projection: { _id: false, 'private._type': true, 'private.name.string': true }
  })

  return {
    typeId: entity?.private?._type?.at(0)?.reference,
    type: entity?.private?._type?.at(0)?.string,
    name: entity?.private?.name?.at(0)?.string
  }
}

// One line per written or removed value - old is the value replaced or deleted, new the value written
function writeChanges (name, args, values) {
  if (name === 'delete_property') {
    const record = values?.get(args._id)

    return record ? [{ property: record.type, language: record.language, old: plainValue(record) }] : undefined
  }

  if (name !== 'create_entity' && name !== 'update_entity') return

  return args.properties.map((property) => ({
    property: property.type,
    language: property.language,
    old: property.valueId ? plainValue(values?.get(property.valueId)) : undefined,
    new: plainValue(property)
  }))
}

// The bare value of a property record or a tool property argument
function plainValue (value) {
  if (!value) return
  if (value.reference) {
    return value.reference.toString()
  }

  return value.string ?? value.number ?? value.boolean ?? value.date ?? value.datetime ?? value.filename
}
