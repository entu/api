// Tools executed immediately during the agent loop - everything else is queued as a proposal
export const aiReadToolNames = ['get_entity_type', 'search_entities', 'get_entity', 'get_file_url', 'get_entity_history']

// Schema for multilingual definition texts (label, label_plural, description, group) - one item per language
function multilingualTextSchema (description) {
  return {
    type: 'array',
    description: `${description} One item per language; omit language for a language-neutral value.`,
    items: {
      type: 'object',
      properties: {
        string: { type: 'string', description: 'Text value' },
        language: { type: 'string', description: 'Language code (en or et)' }
      },
      required: ['string']
    }
  }
}

const propertyValueSchema = {
  type: 'object',
  properties: {
    type: { type: 'string', description: 'Property name (snake_case, no leading underscore)' },
    valueId: { type: 'string', description: 'To CHANGE an existing value: the _id of the exact value to replace, taken from that value object inside get_entity output (e.g. name: [{ _id: "...", string: "John" }] -> use that _id). This is a value _id, NOT an entity _id and NOT a property definition _id. Omit to ADD a new value.' },
    string: { type: 'string', description: 'String/text value' },
    number: { type: 'number', description: 'Number value' },
    boolean: { type: 'boolean', description: 'Boolean value' },
    reference: { type: 'string', description: 'Referenced entity id, or a tempId ("$1", "$2", ...) of an earlier queued operation' },
    date: { type: 'string', description: 'Date value (YYYY-MM-DD)' },
    datetime: { type: 'string', description: 'Datetime value (ISO 8601)' },
    language: { type: 'string', description: 'Language code (en or et) for multilingual properties' }
  },
  required: ['type']
}

// OpenAI-compatible function schemas for all tools offered to the model
export const aiToolDefinitions = [
  {
    type: 'function',
    function: {
      name: 'get_entity_type',
      description: 'Get an entity type definition and all its property definitions by type name.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Entity type name (snake_case)' }
        },
        required: ['name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_entities',
      description: 'Search entities by type, full-text query and/or property filters. Returns at most 100 entities per call; the count field in the result is the TOTAL number of matches - use skip to page through the rest.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', description: 'Entity type name to filter by' },
          query: { type: 'string', description: 'Full-text substring search' },
          filter: {
            type: 'object',
            description: 'Property filters. Keys are "propertyname.valuetype" (valuetype is string, number, boolean, reference, date or datetime). A scalar value matches equality; an object with gt/gte/lt/lte keys matches a range. Examples: { "name.string": "John" }, { "weight.number": { "lt": 300 } }',
            additionalProperties: true
          },
          props: {
            type: 'array',
            description: 'Property values to return for each match, system properties like _parent and _sharing included. If omitted, only the name is returned - enough to list and link. Ask for what you will actually show.',
            items: { type: 'string' }
          },
          sort: {
            type: 'array',
            description: 'Sort order, as "propertyname.valuetype" entries with a leading "-" for descending. Use this for "newest", "largest", "first" questions instead of paging - e.g. ["-created.datetime"] or ["name.string"].',
            items: { type: 'string' }
          },
          group: {
            type: 'array',
            description: 'Group results by these "propertyname.valuetype" keys, returning one entity per distinct value with _count set. Use this to count per category instead of paging everything - e.g. ["status.string"].',
            items: { type: 'string' }
          },
          limit: { type: 'integer', description: 'Maximum number of entities to return (max 100)' },
          skip: { type: 'integer', description: 'Number of entities to skip - use with limit to page through more than 20 results' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_entity',
      description: 'Get a single entity by id.',
      parameters: {
        type: 'object',
        properties: {
          _id: { type: 'string', description: 'Entity id' },
          props: {
            type: 'array',
            description: 'Property names to return, system properties included. If omitted, every readable property is returned - name the ones you need when you only need a few.',
            items: { type: 'string' }
          }
        },
        required: ['_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_entity_history',
      description: 'Get an entity\'s change history - who changed which property, when, and the old and new values, newest first. Needs direct rights on the entity, so it can fail where get_entity succeeds.',
      parameters: {
        type: 'object',
        properties: {
          _id: { type: 'string', description: 'Entity id' },
          limit: { type: 'integer', description: 'Maximum number of changes to return (max 50)' },
          skip: { type: 'integer', description: 'Number of changes to skip - use with limit to page through more' }
        },
        required: ['_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_file_url',
      description: 'Get a short-lived download URL for a file property. Takes the property _id from a file value inside get_entity output, not an entity id.',
      parameters: {
        type: 'object',
        properties: {
          _id: { type: 'string', description: 'File property id' }
        },
        required: ['_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_entity_type',
      description: 'Queue creation of a new entity type. Not executed until the user confirms. The result tempId ("$1", "$2", ...) can be used as entityType/type/reference in later operations.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Type name (snake_case identifier)' },
          label: multilingualTextSchema('Human-readable label.'),
          labelPlural: multilingualTextSchema('Plural label.'),
          description: multilingualTextSchema('Description of the type.')
        },
        required: ['name', 'label']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'add_property_definition',
      description: 'Queue adding a property definition to an entity type. Not executed until the user confirms. entityType may be an existing type name or a tempId ("$1", ...) returned by an earlier queued create_entity_type.',
      parameters: {
        type: 'object',
        properties: {
          entityType: { type: 'string', description: 'Entity type name, or tempId of an earlier queued operation' },
          name: { type: 'string', description: 'Property name (snake_case identifier)' },
          type: {
            type: 'string',
            description: 'Property value type',
            enum: entityPropertyTypes
          },
          label: multilingualTextSchema('Human-readable label.'),
          description: multilingualTextSchema('Description of the property.'),
          group: multilingualTextSchema('Group name for visually grouping properties in the edit form.'),
          mandatory: { type: 'boolean', description: 'Value is required' },
          multilingual: { type: 'boolean', description: 'Separate value per language' },
          list: { type: 'boolean', description: 'Multiple values allowed' },
          readonly: { type: 'boolean', description: 'Value cannot be edited manually' },
          formula: { type: 'string', description: 'RPN formula (for formula-type properties)' },
          ordinal: { type: 'number', description: 'Sort order among the type\'s properties' },
          decimals: { type: 'number', description: 'Number of decimals (for number-type properties)' },
          default: { type: 'string', description: 'Default value' },
          referenceQuery: { type: 'string', description: 'Query limiting selectable entities (for reference-type properties)' },
          set: {
            type: 'array',
            description: 'Allowed values (renders as a select)',
            items: { type: 'string' }
          },
          search: { type: 'boolean', description: 'Include value in full-text search index' }
        },
        required: ['entityType', 'name', 'type']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_entity',
      description: 'Queue creation of a new entity. Not executed until the user confirms. type and parent may be a tempId ("$1", ...) of an earlier queued operation; reference values inside properties may be tempIds too.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', description: 'Entity type name, or tempId of an earlier queued create_entity_type' },
          parent: { type: 'string', description: 'Parent entity id, or tempId of an earlier queued operation' },
          properties: {
            type: 'array',
            description: 'Properties to set on the new entity',
            items: propertyValueSchema
          }
        },
        required: ['type', 'properties']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_entity',
      description: 'Queue changing an existing entity. Each property ADDS a new value, unless it includes valueId (an existing value _id from get_entity), in which case it REPLACES that value. Not executed until the user confirms. _id may be a tempId ("$1", ...) of an earlier queued operation; reference values may be tempIds too.',
      parameters: {
        type: 'object',
        properties: {
          _id: { type: 'string', description: 'Entity id, or tempId of an earlier queued operation' },
          properties: {
            type: 'array',
            description: 'Properties to add or replace',
            items: propertyValueSchema
          }
        },
        required: ['_id', 'properties']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_property',
      description: 'Queue deletion of a single property value by its property id (returned inside entity properties as _id). Not executed until the user confirms. System properties cannot be deleted.',
      parameters: {
        type: 'object',
        properties: {
          _id: { type: 'string', description: 'Property id to delete' }
        },
        required: ['_id']
      }
    }
  }
]

// Executes a read tool as the calling user (rights filtering applies) and returns a JSON-serializable result
export async function aiExecuteReadTool (entu, name, args) {
  switch (name) {
    case 'get_entity_type':
      return await getEntityTypeTool(entu, args)
    case 'search_entities':
      return await searchEntitiesTool(entu, args)
    case 'get_entity':
      return await getEntityTool(entu, args)
    case 'get_file_url':
      return await getFileUrlTool(entu, args)
    case 'get_entity_history':
      return await getEntityHistoryTool(entu, args)
    default:
      throw createError({
        statusCode: 400,
        statusMessage: `Unknown tool ${name}`
      })
  }
}

// Returns the entity type definition entity and its property definition children as compact JSON
async function getEntityTypeTool (entu, args) {
  if (typeof args?.name !== 'string' || !/^[a-z0-9_]+$/.test(args.name)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid entity type name'
    })
  }

  const typeEntity = await entu.db.collection('entity').findOne({
    'private._type.string': 'entity',
    'private.name.string': args.name,
    access: accessFilter(entu)
  })

  if (!typeEntity) {
    throw createError({
      statusCode: 404,
      statusMessage: `Entity type ${args.name} not found`
    })
  }

  const cleanedType = await cleanupEntity(entu, typeEntity)

  if (!cleanedType) {
    throw createError({
      statusCode: 403,
      statusMessage: 'No accessible properties'
    })
  }

  // No cursor sort — private.* fields are parallel arrays MongoDB refuses to sort on; sorted in JS below
  const propertyEntities = await entu.db.collection('entity').find({
    'private._parent.reference': typeEntity._id,
    'private._type.string': 'property',
    access: accessFilter(entu)
  }).toArray()

  const properties = []

  for (const propertyEntity of propertyEntities) {
    const cleaned = await cleanupEntity(entu, propertyEntity)

    if (!cleaned) continue

    properties.push({
      _id: cleaned._id.toString(),
      name: definitionValue(cleaned.name),
      type: definitionValue(cleaned.type),
      label: definitionTextValue(cleaned.label),
      labelPlural: definitionTextValue(cleaned.label_plural),
      description: definitionTextValue(cleaned.description),
      group: definitionTextValue(cleaned.group),
      mandatory: definitionValue(cleaned.mandatory),
      multilingual: definitionValue(cleaned.multilingual),
      list: definitionValue(cleaned.list),
      readonly: definitionValue(cleaned.readonly),
      search: definitionValue(cleaned.search),
      formula: definitionValue(cleaned.formula),
      ordinal: definitionValue(cleaned.ordinal),
      decimals: definitionValue(cleaned.decimals),
      default: definitionValue(cleaned.default),
      referenceQuery: definitionValue(cleaned.reference_query),
      set: cleaned.set?.map((x) => x.string).filter((x) => x !== undefined)
    })
  }

  properties.sort(comparePropertyDefinitions)

  return {
    _id: cleanedType._id.toString(),
    name: definitionValue(cleanedType.name),
    label: definitionTextValue(cleanedType.label),
    labelPlural: definitionTextValue(cleanedType.label_plural),
    description: definitionTextValue(cleanedType.description),
    properties
  }
}

// Searches entities with access filtering, optional type/full-text/property filters and a capped limit
async function searchEntitiesTool (entu, args) {
  const limit = Math.min(Number.parseInt(args?.limit) || 100, 100)
  const skip = Math.min(Number.parseInt(args?.skip) || 0, 10000)
  const filter = {}
  let search = []

  if (args?.type !== undefined) {
    if (typeof args.type !== 'string' || !/^[a-z0-9_]+$/.test(args.type)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Invalid type'
      })
    }

    filter['private._type.string'] = args.type
  }

  if (args?.query !== undefined) {
    if (typeof args.query !== 'string') {
      throw createError({
        statusCode: 400,
        statusMessage: 'Invalid query'
      })
    }

    search = args.query.split(' ')
  }

  if (args?.filter !== undefined) {
    if (typeof args.filter !== 'object' || args.filter === null || Array.isArray(args.filter)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Filter must be an object'
      })
    }

    for (const [key, value] of Object.entries(args.filter)) {
      if (!/^[a-z0-9_]+\.(string|number|boolean|reference|date|datetime)$/.test(key)) {
        throw createError({
          statusCode: 400,
          statusMessage: `Invalid filter key ${key}`
        })
      }

      const valueType = key.split('.').at(1)

      filter[`private.${key}`] = buildFilterCondition(valueType, value, key)
    }
  }

  // Default to a lean result (name only) - the model requests specific props for values, or uses get_entity for full detail
  const props = args?.props === undefined ? ['name'] : validateToolProps(args.props)
  const sort = validateToolKeys(args?.sort, 'sort', true)
  const group = validateToolKeys(args?.group, 'group')

  const { entities, count } = await queryEntities(entu, { filter, search, props, group, sort, limit, skip })

  return {
    entities: entities.map(compactEntity),
    count,
    limit,
    skip
  }
}

// Validates the model-provided props array and returns it as plain property names
function validateToolProps (props) {
  if (props === undefined) {
    return []
  }

  if (!Array.isArray(props) || props.some((p) => typeof p !== 'string' || !/^_?[a-z0-9_]+$/.test(p))) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid props'
    })
  }

  return props
}

// Returns a single entity by id with rights check as compact JSON
async function getEntityTool (entu, args) {
  const entityId = parseToolObjectId(args?._id)
  const projection = buildPropsProjection(args?.props)

  const entity = await entu.db.collection('entity').findOne({
    _id: entityId
  }, {
    projection
  })

  if (!entity) {
    throw createError({
      statusCode: 404,
      statusMessage: `Entity ${entityId} not found`
    })
  }

  const cleaned = await cleanupEntity(entu, entity)

  if (!cleaned) {
    throw createError({
      statusCode: 403,
      statusMessage: 'No accessible properties'
    })
  }

  return { entity: compactEntity(cleaned) }
}

// Validates and converts a single scalar filter value to its MongoDB representation
// Builds a MongoDB condition from a filter value - scalar for equality, gt/gte/lt/lte object for ranges
function buildFilterCondition (valueType, value, key) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return parseFilterValue(valueType, value, key)
  }

  const rangeOperators = ['gt', 'gte', 'lt', 'lte']
  const keys = Object.keys(value)

  if (keys.length === 0 || keys.some((operator) => !rangeOperators.includes(operator))) {
    throw createError({
      statusCode: 400,
      statusMessage: `Invalid filter value for ${key}`
    })
  }

  const condition = {}

  for (const operator of keys) {
    condition[`$${operator}`] = parseFilterValue(valueType, value[operator], key)
  }

  return condition
}

// Parses a single scalar filter value according to the key's value type
function parseFilterValue (valueType, value, key) {
  const invalidValueError = createError({
    statusCode: 400,
    statusMessage: `Invalid filter value for ${key}`
  })

  switch (valueType) {
    case 'string':
      if (typeof value !== 'string') {
        throw invalidValueError
      }

      return value
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw invalidValueError
      }

      return value
    case 'boolean':
      if (typeof value !== 'boolean') {
        throw invalidValueError
      }

      return value
    case 'reference':
      if (typeof value !== 'string') {
        throw invalidValueError
      }

      return parseToolObjectId(value)
    default: { // date, datetime
      if (typeof value !== 'string') {
        throw invalidValueError
      }

      const date = new Date(value)

      if (Number.isNaN(date.getTime())) {
        throw invalidValueError
      }

      return date
    }
  }
}

// Builds a MongoDB projection from a props array — undefined projection when no props given
function buildPropsProjection (props) {
  if (props === undefined) return

  if (!Array.isArray(props) || props.some((p) => typeof p !== 'string' || !/^_?[a-z0-9_]+$/.test(p))) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid props'
    })
  }

  if (props.length === 0) return

  const projection = { access: true }

  for (const p of props) {
    projection[`private.${p}`] = true
    projection[`public.${p}`] = true
    projection[`domain.${p}`] = true
  }

  return projection
}

// Parses a model-provided entity id string into an ObjectId or throws 400
function parseToolObjectId (value) {
  try {
    return getObjectId(value)
  }
  catch {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid _id'
    })
  }
}

// The only system (underscore) properties the AI is allowed to see - everything else, including all rights properties, is dropped
// Returns an entity's change history, requiring the same direct rights the REST history route does
async function getEntityHistoryTool (entu, args) {
  const entityId = parseToolObjectId(args?._id)

  const entity = await entu.db.collection('entity').findOne({ _id: entityId }, { projection: { _id: false, access: true } })

  if (!entity) {
    throw createError({ statusCode: 404, statusMessage: `Entity ${entityId} not found` })
  }

  if (!entity.access?.map((x) => x.toString()).includes(entu.userStr)) {
    throw createError({ statusCode: 403, statusMessage: 'User not in any rights property' })
  }

  return await entityHistory(entu, entityId, {
    limit: Math.min(Number.parseInt(args?.limit) || 20, 50),
    skip: Math.min(Number.parseInt(args?.skip) || 0, 10000)
  })
}

// Returns a short-lived signed URL for one file property, checking access exactly as the REST property route does
async function getFileUrlTool (entu, args) {
  const propertyId = parseToolObjectId(args?._id)

  const property = await entu.db.collection('property').findOne({ _id: propertyId, deleted: { $exists: false } })

  if (!property?.filename) {
    throw createError({ statusCode: 404, statusMessage: 'File property not found' })
  }

  const entity = await entu.db.collection('entity').findOne({ _id: property.entity }, {
    projection: {
      _id: false,
      access: true,
      [`domain.${property.type}._id`]: true,
      [`public.${property.type}._id`]: true
    }
  })

  if (!entity || !canReadProperty(entu, entity, property)) {
    throw createError({ statusCode: 403, statusMessage: 'No access to property' })
  }

  return {
    filename: property.filename,
    filesize: property.filesize,
    filetype: property.filetype,
    url: await getSignedDownloadUrl(entu.account, property.entity, property)
  }
}

// Validates sort/group entries - each names a property and its value type, sort allowing a leading "-" for descending
function validateToolKeys (value, field, allowDescending = false) {
  if (value === undefined) {
    return []
  }

  if (!Array.isArray(value) || value.length > 5) {
    throw createError({ statusCode: 400, statusMessage: `${field} must be an array of up to 5 keys` })
  }

  for (const key of value) {
    const name = allowDescending && typeof key === 'string' ? key.replace(/^-/, '') : key

    if (typeof name !== 'string' || !/^[a-z0-9_]+\.(string|number|boolean|reference|date|datetime)$/.test(name)) {
      throw createError({ statusCode: 400, statusMessage: `Invalid ${field} key ${key}` })
    }
  }

  return value
}

// Reduces a cleaned entity to a compact JSON shape for the model — same properties the REST API returns, with value metadata trimmed
function compactEntity (entity) {
  const result = { _id: entity._id.toString() }

  for (const [key, values] of Object.entries(entity)) {
    if (key === '_id' || !Array.isArray(values)) continue

    result[key] = values.map(compactValue)
  }

  return result
}

// Reduces a property value object to its bare value (with language/id where present)
function compactValue (value) {
  const compact = {}

  if (value._id) {
    compact._id = value._id.toString()
  }

  for (const field of ['string', 'number', 'boolean', 'date', 'datetime', 'language', 'filename', 'filesize']) {
    if (value[field] !== undefined && value[field] !== null) {
      compact[field] = value[field]
    }
  }

  if (value.reference) {
    compact.reference = value.reference.toString()
  }

  return compact
}

// Returns a definition text property with all language values - array of { string, language } matching the write tools' shape
function definitionTextValue (values) {
  const result = values
    ?.filter((value) => value.string !== undefined)
    .map((value) => value.language ? { string: value.string, language: value.language } : { string: value.string })

  if (!result?.length) return

  return result
}

// Returns the first raw value of a definition property
function definitionValue (values) {
  const value = values?.at(0)

  if (!value) return

  return value.string ?? value.number ?? value.boolean
}

// Orders property definitions by ordinal (missing last), then by name — matching the webapp's ordering
function comparePropertyDefinitions (a, b) {
  const ordinalA = typeof a.ordinal === 'number' ? a.ordinal : Number.MAX_SAFE_INTEGER
  const ordinalB = typeof b.ordinal === 'number' ? b.ordinal : Number.MAX_SAFE_INTEGER

  if (ordinalA !== ordinalB) {
    return ordinalA - ordinalB
  }

  return (a.name || '').localeCompare(b.name || '')
}
