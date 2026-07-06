const operationTypes = ['create_entity_type', 'add_property_definition', 'create_entity', 'update_entity', 'delete_property']
const namePattern = /^[a-z][a-z0-9_]*$/
const tempIdPattern = /^\$\d+$/
const propertyValueFields = ['string', 'number', 'boolean', 'reference', 'date', 'datetime']

// Validates a proposed operations array — throws createError 400 on any violation
export function aiValidateOperations (operations) {
  if (!Array.isArray(operations) || operations.length < 1 || operations.length > 25) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Operations must be an array of 1 to 25 items'
    })
  }

  for (let i = 0; i < operations.length; i++) {
    const operation = operations[i]

    if (!operation || typeof operation !== 'object' || Array.isArray(operation)) {
      throw createError({
        statusCode: 400,
        statusMessage: `Operation ${i} must be an object`
      })
    }

    if (!operationTypes.includes(operation.op)) {
      throw createError({
        statusCode: 400,
        statusMessage: `Operation ${i} has unknown op`
      })
    }

    const params = operation.params

    if (!params || typeof params !== 'object' || Array.isArray(params)) {
      throw createError({
        statusCode: 400,
        statusMessage: `Operation ${i} must have params object`
      })
    }

    switch (operation.op) {
      case 'create_entity_type':
        validateCreateEntityType(params, i)
        break
      case 'add_property_definition':
        validateAddPropertyDefinition(params, i, operations)
        break
      case 'create_entity':
        validateCreateEntity(params, i, operations)
        break
      case 'update_entity':
        validateUpdateEntity(params, i, operations)
        break
      case 'delete_property':
        validateDeleteProperty(params, i)
        break
    }
  }
}

// Returns a deterministic English description of a single operation for the confirmation UI
export function aiDescribeOperation (operation) {
  const params = operation.params

  switch (operation.op) {
    case 'create_entity_type':
      return `Create entity type "${params.name}" labeled "${params.label}"`
    case 'add_property_definition': {
      const flags = []

      if (params.mandatory) {
        flags.push('mandatory')
      }
      if (params.multilingual) {
        flags.push('multilingual')
      }
      if (params.list) {
        flags.push('list')
      }
      if (params.readonly) {
        flags.push('readonly')
      }
      if (params.formula) {
        flags.push(`formula: ${params.formula}`)
      }

      const suffix = flags.length > 0 ? ` (${flags.join(', ')})` : ''

      return `Add ${params.type} property "${params.name}" to entity type ${params.entityType}${suffix}`
    }
    case 'create_entity': {
      const parent = params.parent ? ` under parent ${params.parent}` : ''

      return `Create a new ${params.type} entity${parent} with ${params.properties.length} ${params.properties.length === 1 ? 'property' : 'properties'}`
    }
    case 'update_entity':
      return `Set ${params.properties.length} ${params.properties.length === 1 ? 'property' : 'properties'} on entity ${params._id}`
    case 'delete_property':
      return `Delete property ${params._id}`
    default:
      return `Unknown operation ${operation.op}`
  }
}

// Executes validated operations sequentially, resolving tempIds. Stops on first failure and returns partial results.
export async function aiExecuteOperations (entu, operations) {
  const tempIdMap = new Map()
  const results = []

  for (let i = 0; i < operations.length; i++) {
    const operation = operations[i]
    const tempId = `$${i + 1}`

    try {
      const _id = await executeOperation(entu, operation, tempIdMap)

      if (_id) {
        tempIdMap.set(tempId, _id)
      }

      results.push({ tempId, _id: _id?.toString(), op: operation.op })
    }
    catch (error) {
      return {
        results,
        error: {
          index: i,
          statusCode: error.statusCode || 500,
          statusMessage: error.statusMessage || 'Operation failed'
        }
      }
    }
  }

  return { results }
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

// Reserved type-definition names - the platform's base types, whose type definitions the AI must never create or change
const reservedTypeNames = ['database', 'entity', 'menu', 'plugin', 'property']

// Throws when a type name refers to a reserved base type
function rejectReservedTypeName (value, index) {
  if (reservedTypeNames.includes(value)) {
    throw operationError(index, `Entity type ${value} is reserved and can't be created or changed`)
  }
}

// Throws when creating a type definition (an entity of type "entity") with a reserved name
function rejectReservedTypeCreation (params, index) {
  if (params.type !== 'entity') {
    return
  }

  const name = params.properties?.find((property) => property?.type === 'name')?.string

  if (reservedTypeNames.includes(name)) {
    throw operationError(index, `Entity type ${name} is reserved and can't be created`)
  }
}

// Builds a 400 error pointing at the failing operation index
function operationError (index, message) {
  return createError({
    statusCode: 400,
    statusMessage: `Operation ${index}: ${message}`
  })
}

// Validates an optional/required string param against length and pattern limits
function validateString (value, field, index, { required = false, max = 1000, pattern } = {}) {
  if (value === undefined) {
    if (required) {
      throw operationError(index, `${field} is required`)
    }

    return
  }

  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    throw operationError(index, `${field} must be a string of 1 to ${max} characters`)
  }

  if (pattern && !pattern.test(value)) {
    throw operationError(index, `${field} has invalid format`)
  }
}

// Validates an optional boolean param
function validateBoolean (value, field, index) {
  if (value !== undefined && typeof value !== 'boolean') {
    throw operationError(index, `${field} must be a boolean`)
  }
}

// Validates an optional finite number param
function validateNumber (value, field, index) {
  if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value))) {
    throw operationError(index, `${field} must be a number`)
  }
}

// Validates a "$n" tempId reference — must point to an earlier, id-producing operation
function validateTempIdRef (value, field, index, operations) {
  const n = Number.parseInt(value.slice(1), 10)

  if (!Number.isInteger(n) || n < 1 || n > index) {
    throw operationError(index, `${field} tempId ${value} must reference an earlier operation`)
  }

  if (operations[n - 1].op === 'delete_property') {
    throw operationError(index, `${field} tempId ${value} references an operation that does not create or update an entity`)
  }
}

// Validates a field that is either an ObjectId string or a tempId reference
function validateEntityRef (value, field, index, operations) {
  if (typeof value !== 'string') {
    throw operationError(index, `${field} must be a string`)
  }

  if (tempIdPattern.test(value)) {
    validateTempIdRef(value, field, index, operations)

    return
  }

  validateObjectIdString(value, field, index)
}

// Validates a param that must be a MongoDB ObjectId string
function validateObjectIdString (value, field, index) {
  try {
    getObjectId(value)
  }
  catch {
    throw operationError(index, `${field} must be a valid entity id`)
  }
}

// Validates create_entity_type params
function validateCreateEntityType (params, index) {
  validateString(params.name, 'name', index, { required: true, max: 100, pattern: namePattern })
  rejectReservedTypeName(params.name, index)
  validateString(params.label, 'label', index, { required: true })
  validateString(params.labelPlural, 'labelPlural', index)
  validateString(params.description, 'description', index, { max: 5000 })
}

// Validates add_property_definition params
function validateAddPropertyDefinition (params, index, operations) {
  if (typeof params.entityType !== 'string') {
    throw operationError(index, 'entityType must be a string')
  }

  if (tempIdPattern.test(params.entityType)) {
    validateTempIdRef(params.entityType, 'entityType', index, operations)
  }
  else if (!namePattern.test(params.entityType)) {
    throw operationError(index, 'entityType must be a type name or a tempId')
  }

  validateString(params.name, 'name', index, { required: true, max: 100, pattern: namePattern })

  if (!entityPropertyTypes.includes(params.type)) {
    throw operationError(index, `type must be one of ${entityPropertyTypes.join(', ')}`)
  }

  validateString(params.label, 'label', index)
  validateString(params.description, 'description', index, { max: 5000 })
  validateBoolean(params.mandatory, 'mandatory', index)
  validateBoolean(params.multilingual, 'multilingual', index)
  validateBoolean(params.list, 'list', index)
  validateBoolean(params.readonly, 'readonly', index)
  validateBoolean(params.search, 'search', index)
  validateString(params.formula, 'formula', index, { max: 5000 })
  validateNumber(params.ordinal, 'ordinal', index)
  validateNumber(params.decimals, 'decimals', index)
  validateString(params.default, 'default', index)
  validateString(params.referenceQuery, 'referenceQuery', index)

  if (params.set !== undefined) {
    if (!Array.isArray(params.set) || params.set.length === 0 || params.set.length > 100) {
      throw operationError(index, 'set must be an array of 1 to 100 strings')
    }

    for (const value of params.set) {
      if (typeof value !== 'string' || value.length === 0 || value.length > 1000) {
        throw operationError(index, 'set values must be strings of 1 to 1000 characters')
      }
    }
  }
}

// Validates create_entity params
function validateCreateEntity (params, index, operations) {
  if (typeof params.type !== 'string') {
    throw operationError(index, 'type must be a string')
  }

  if (tempIdPattern.test(params.type)) {
    validateTempIdRef(params.type, 'type', index, operations)
  }
  else if (!namePattern.test(params.type)) {
    throw operationError(index, 'type must be a type name or a tempId')
  }
  else if (params.type === 'database') {
    throw operationError(index, 'Entities of type database can\'t be created')
  }

  if (params.parent !== undefined) {
    validateEntityRef(params.parent, 'parent', index, operations)
  }

  validateProperties(params.properties, index, operations, { allowEmpty: true })

  rejectReservedTypeCreation(params, index)
}

// Validates update_entity params
function validateUpdateEntity (params, index, operations) {
  validateEntityRef(params._id, '_id', index, operations)
  validateProperties(params.properties, index, operations, { allowEmpty: false })
}

// Validates delete_property params
function validateDeleteProperty (params, index) {
  if (typeof params._id !== 'string') {
    throw operationError(index, '_id must be a string')
  }

  validateObjectIdString(params._id, '_id', index)
}

// Validates a properties array of a create_entity/update_entity operation
function validateProperties (properties, index, operations, { allowEmpty }) {
  if (!Array.isArray(properties) || properties.length > 100 || (!allowEmpty && properties.length === 0)) {
    throw operationError(index, `properties must be an array of ${allowEmpty ? 0 : 1} to 100 items`)
  }

  for (const property of properties) {
    if (!property || typeof property !== 'object' || Array.isArray(property)) {
      throw operationError(index, 'each property must be an object')
    }

    validateString(property.type, 'property type', index, { required: true, max: 100, pattern: namePattern })

    const valueFields = propertyValueFields.filter((field) => property[field] !== undefined)

    if (valueFields.length !== 1) {
      throw operationError(index, `property ${property.type} must have exactly one value of ${propertyValueFields.join(', ')}`)
    }

    const field = valueFields.at(0)
    const value = property[field]

    switch (field) {
      case 'string':
        if (typeof value !== 'string' || value.length === 0 || value.length > 100000) {
          throw operationError(index, `property ${property.type} string value is invalid`)
        }
        break
      case 'number':
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          throw operationError(index, `property ${property.type} number value is invalid`)
        }
        break
      case 'boolean':
        if (typeof value !== 'boolean') {
          throw operationError(index, `property ${property.type} boolean value is invalid`)
        }
        break
      case 'reference':
        validateEntityRef(value, `property ${property.type} reference`, index, operations)
        break
      default: // date, datetime
        if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime())) {
          throw operationError(index, `property ${property.type} ${field} value is invalid`)
        }
    }

    if (property.language !== undefined && (typeof property.language !== 'string' || !/^[a-z]{2}$/.test(property.language))) {
      throw operationError(index, `property ${property.type} language must be a two-letter code`)
    }
  }
}

// ---------------------------------------------------------------------------
// Execution helpers
// ---------------------------------------------------------------------------

// Executes a single operation and returns the affected entity id (or undefined for delete_property)
async function executeOperation (entu, operation, tempIdMap) {
  switch (operation.op) {
    case 'create_entity_type':
      return await executeCreateEntityType(entu, operation.params)
    case 'add_property_definition':
      return await executeAddPropertyDefinition(entu, operation.params, tempIdMap)
    case 'create_entity':
      return await executeCreateEntity(entu, operation.params, tempIdMap)
    case 'update_entity':
      return await executeUpdateEntity(entu, operation.params, tempIdMap)
    case 'delete_property':
      return await executeDeleteProperty(entu, operation.params)
  }
}

// Resolves a base definition type ("entity" or "property") to its defining entity id
async function getBaseTypeId (entu, name) {
  const baseType = await entu.db.collection('entity').findOne({
    'private._type.string': 'entity',
    'private.name.string': name
  }, {
    projection: { _id: true }
  })

  if (!baseType) {
    throw createError({
      statusCode: 400,
      statusMessage: `Base type ${name} not found in this account`
    })
  }

  return baseType._id
}

// Resolves an entity type reference — a tempId of an earlier operation or an existing type name readable by the user
async function resolveTypeId (entu, value, tempIdMap) {
  if (tempIdPattern.test(value)) {
    return resolveTempId(value, tempIdMap)
  }

  const typeEntity = await entu.db.collection('entity').findOne({
    'private._type.string': 'entity',
    'private.name.string': value,
    access: { $in: [entu.user, 'domain', 'public'] }
  }, {
    projection: { _id: true }
  })

  if (!typeEntity) {
    throw createError({
      statusCode: 400,
      statusMessage: `Entity type ${value} not found`
    })
  }

  return typeEntity._id
}

// Resolves an entity reference — a tempId of an earlier operation or an ObjectId string
function resolveEntityId (value, tempIdMap) {
  if (tempIdPattern.test(value)) {
    return resolveTempId(value, tempIdMap)
  }

  return getObjectId(value)
}

// Throws when the entity is a system type definition - a type "entity" entity that carries a system property or has a reserved name
async function rejectSystemTypeDefinition (entu, entityId) {
  const entity = await entu.db.collection('entity').findOne({ _id: entityId }, { projection: { 'private._type.string': true, 'private.name.string': true, 'private.system': true } })

  const isTypeDefinition = entity?.private?._type?.at(0)?.string === 'entity'
  const isSystem = (entity?.private?.system?.length || 0) > 0
  const isReserved = reservedTypeNames.includes(entity?.private?.name?.at(0)?.string)

  if (isTypeDefinition && (isSystem || isReserved)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'System type definitions can\'t be changed'
    })
  }
}

// Maps a tempId to the entity id created by an earlier executed operation
function resolveTempId (value, tempIdMap) {
  const _id = tempIdMap.get(value)

  if (!_id) {
    throw createError({
      statusCode: 400,
      statusMessage: `TempId ${value} does not resolve to an entity`
    })
  }

  return _id
}

// Creates a new entity type definition entity
async function executeCreateEntityType (entu, params) {
  const existing = await entu.db.collection('entity').findOne({
    'private._type.string': 'entity',
    'private.name.string': params.name
  }, {
    projection: { _id: true }
  })

  if (existing) {
    throw createError({
      statusCode: 400,
      statusMessage: `Entity type name ${params.name} is not available`
    })
  }

  const properties = await buildOperationProperties({ op: 'create_entity_type', params }, executionResolvers(entu))

  const { _id } = await setEntity(entu, null, properties)

  await triggerWebhooks(entu, _id, 'entity-add-webhook')

  return _id
}

// Creates a new property definition entity under an entity type
async function executeAddPropertyDefinition (entu, params, tempIdMap) {
  const typeId = await resolveTypeId(entu, params.entityType, tempIdMap)

  await rejectSystemTypeDefinition(entu, typeId)

  const existing = await entu.db.collection('entity').findOne({
    'private._type.string': 'property',
    'private._parent.reference': typeId,
    'private.name.string': params.name
  }, {
    projection: { _id: true }
  })

  if (existing) {
    throw createError({
      statusCode: 400,
      statusMessage: `Property name ${params.name} is not available on entity type ${params.entityType}`
    })
  }

  // typeId is already resolved for the duplicate check above - reuse it instead of resolving twice
  const properties = await buildOperationProperties({ op: 'add_property_definition', params }, { ...executionResolvers(entu), typeId: async () => typeId })

  const { _id } = await setEntity(entu, null, properties)

  await triggerWebhooks(entu, _id, 'entity-add-webhook')

  return _id
}

// Creates a new data entity with the given properties
async function executeCreateEntity (entu, params, tempIdMap) {
  const properties = await buildOperationProperties({ op: 'create_entity', params }, executionResolvers(entu, tempIdMap))

  const { _id } = await setEntity(entu, null, properties)

  await triggerWebhooks(entu, _id, 'entity-add-webhook')

  return _id
}

// Adds property values to an existing entity
async function executeUpdateEntity (entu, params, tempIdMap) {
  const entityId = resolveEntityId(params._id, tempIdMap)

  await rejectSystemTypeDefinition(entu, entityId)

  const properties = await buildOperationProperties({ op: 'update_entity', params }, executionResolvers(entu, tempIdMap))

  const { _id } = await setEntity(entu, entityId, properties)

  await triggerWebhooks(entu, _id, 'entity-edit-webhook')

  return _id
}

// Builds the property array an operation passes to setEntity. Resolvers map symbolic
// references (base type names, type names, tempIds) to entity ids - pass-through for
// proposal previews, database-backed during execution.
async function buildOperationProperties (operation, resolve) {
  const params = operation.params

  switch (operation.op) {
    case 'create_entity_type': {
      const properties = [
        { type: '_type', reference: await resolve.baseType('entity') },
        { type: 'name', string: params.name },
        { type: 'label', string: params.label }
      ]

      if (params.labelPlural) {
        properties.push({ type: 'label_plural', string: params.labelPlural })
      }
      if (params.description) {
        properties.push({ type: 'description', string: params.description })
      }

      return properties
    }
    case 'add_property_definition': {
      const properties = [
        { type: '_type', reference: await resolve.baseType('property') },
        { type: '_parent', reference: await resolve.typeId(params.entityType) },
        { type: 'name', string: params.name },
        { type: 'type', string: params.type }
      ]

      if (params.label) {
        properties.push({ type: 'label', string: params.label })
      }
      if (params.description) {
        properties.push({ type: 'description', string: params.description })
      }
      if (params.mandatory !== undefined) {
        properties.push({ type: 'mandatory', boolean: params.mandatory })
      }
      if (params.multilingual !== undefined) {
        properties.push({ type: 'multilingual', boolean: params.multilingual })
      }
      if (params.list !== undefined) {
        properties.push({ type: 'list', boolean: params.list })
      }
      if (params.readonly !== undefined) {
        properties.push({ type: 'readonly', boolean: params.readonly })
      }
      if (params.search !== undefined) {
        properties.push({ type: 'search', boolean: params.search })
      }
      if (params.formula) {
        properties.push({ type: 'formula', string: params.formula })
      }
      if (params.ordinal !== undefined) {
        properties.push({ type: 'ordinal', number: params.ordinal })
      }
      if (params.decimals !== undefined) {
        properties.push({ type: 'decimals', number: params.decimals })
      }
      if (params.default) {
        properties.push({ type: 'default', string: params.default })
      }
      if (params.referenceQuery) {
        properties.push({ type: 'reference_query', string: params.referenceQuery })
      }
      if (params.set) {
        for (const value of params.set) {
          properties.push({ type: 'set', string: value })
        }
      }

      return properties
    }
    case 'create_entity': {
      const properties = [{ type: '_type', reference: await resolve.typeId(params.type) }]

      if (params.parent !== undefined) {
        properties.push({ type: '_parent', reference: await resolve.entityId(params.parent) })
      }

      for (const property of params.properties) {
        properties.push(await buildProperty(property, resolve))
      }

      return properties
    }
    case 'update_entity': {
      const properties = []

      for (const property of params.properties) {
        properties.push(await buildProperty(property, resolve))
      }

      return properties
    }
  }
}

// Resolvers used during execution - look up real entity ids from the database and the tempId map
function executionResolvers (entu, tempIdMap) {
  return {
    baseType: (name) => getBaseTypeId(entu, name),
    typeId: (value) => resolveTypeId(entu, value, tempIdMap),
    entityId: async (value) => resolveEntityId(value, tempIdMap)
  }
}

// Returns the property array as it will be passed to setEntity, with tempIds and type names left unresolved - for showing in the proposal
export async function aiPreviewOperationProperties (operation) {
  const passthrough = async (value) => value

  return buildOperationProperties(operation, { baseType: passthrough, typeId: passthrough, entityId: passthrough })
}

// Builds a single setEntity property record from an operation property object
async function buildProperty (property, resolve) {
  const result = { type: property.type }

  if (property.string !== undefined) {
    result.string = property.string
  }
  if (property.number !== undefined) {
    result.number = property.number
  }
  if (property.boolean !== undefined) {
    result.boolean = property.boolean
  }
  if (property.reference !== undefined) {
    result.reference = await resolve.entityId(property.reference)
  }
  if (property.date !== undefined) {
    result.date = property.date
  }
  if (property.datetime !== undefined) {
    result.datetime = property.datetime
  }
  if (property.language !== undefined) {
    result.language = property.language
  }

  return result
}

// Soft-deletes a property with the same rights checks as the property delete route, but never system properties
async function executeDeleteProperty (entu, params) {
  const propertyId = getObjectId(params._id)

  const property = await entu.db.collection('property').findOne({
    _id: propertyId,
    deleted: { $exists: false }
  }, {
    projection: {
      _id: false,
      entity: true,
      type: true,
      reference: true
    }
  })

  if (!property) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Property not found'
    })
  }

  if (property.type.startsWith('_')) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Can\'t delete system property'
    })
  }

  const entity = await entu.db.collection('entity').findOne({
    _id: property.entity
  }, {
    projection: {
      _id: false,
      'private._editor': true,
      'private._owner': true,
      'private._type.string': true,
      'private.name.string': true,
      'private.system': true
    }
  })

  if (entity?.private?._type?.at(0)?.string === 'entity' && ((entity?.private?.system?.length || 0) > 0 || reservedTypeNames.includes(entity?.private?.name?.at(0)?.string))) {
    throw createError({
      statusCode: 403,
      statusMessage: 'System type definitions can\'t be changed'
    })
  }

  if (!entity) {
    throw createError({
      statusCode: 404,
      statusMessage: `Entity ${property.entity} not found`
    })
  }

  const access = entity.private?._editor?.map((s) => s.reference?.toString()) || []

  if (!access.includes(entu.userStr)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'User not in _owner nor _editor property'
    })
  }

  await entu.db.collection('property').updateOne({
    _id: propertyId,
    entity: property.entity
  }, {
    $set: {
      deleted: {
        at: new Date(),
        by: entu.user
      }
    }
  })

  await aggregateEntity(entu, property.entity)

  await triggerWebhooks(entu, property.entity, 'entity-edit-webhook')
}
