import { createHash, randomBytes } from 'node:crypto'
import jwt from 'jsonwebtoken'

const charsForKey = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*-_=+'

// Validates, processes, and persists properties to a new or existing entity.
// options.skipTypeRequired: if true, skips the _type required check (for system bootstrap only)
export async function setEntity (entu, entityId, properties, options = {}) {
  const allowedTypes = [
    '_type',
    '_parent',
    '_noaccess',
    '_viewer',
    '_expander',
    '_editor',
    '_owner',
    '_sharing',
    '_inheritrights'
  ]

  const rightTypes = [
    '_noaccess',
    '_viewer',
    '_expander',
    '_editor',
    '_owner',
    '_sharing',
    '_inheritrights'
  ]

  const createdDt = new Date()

  validateInput(properties)

  if (!entityId && !options.skipTypeRequired && !properties.some((p) => p.type === '_type')) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Property _type is required'
    })
  }

  await checkEntityAccess(entu, entityId, properties, rightTypes)
  await validatePropertyTypes(entu, properties, allowedTypes)

  if (!entityId) {
    await applyDefaultParents(entu, properties, createdDt)
    await inheritParentProperties(entu, properties, createdDt)
    await applyPropertyDefaults(entu, properties)
    entityId = await createEntityRecord(entu, properties, createdDt)
  }

  const { pIds, oldPIds } = await insertProperties(entu, entityId, properties, createdDt)

  await markPropertiesDeleted(entu, entityId, oldPIds)
  await aggregateEntity(entu, entityId)

  return { _id: entityId, properties: pIds }
}

// Throws if properties is missing, not an array, or empty
function validateInput (properties) {
  if (!properties) {
    throw createError({
      statusCode: 400,
      statusMessage: 'No data'
    })
  }
  if (!Array.isArray(properties)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Data must be array'
    })
  }
  if (properties.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'At least one property must be set'
    })
  }
}

// Verifies the user has editor or owner access to an existing entity
async function checkEntityAccess (entu, entityId, properties, rightTypes) {
  if (!entityId)
    return

  const entity = await entu.db.collection('entity').findOne({
    _id: entityId
  }, {
    projection: {
      _id: false,
      'private._editor': true,
      'private._owner': true
    }
  })

  if (!entity) {
    throw createError({
      statusCode: 404,
      statusMessage: `Entity ${entityId} not found`
    })
  }

  const access = entity.private?._editor?.map((s) => s.reference?.toString()) || []

  if (!access.includes(entu.userStr) && !entu.systemUser) {
    throw createError({
      statusCode: 403,
      statusMessage: 'User not in _owner nor _editor property'
    })
  }

  const rigtsProperties = properties.filter((property) => rightTypes.includes(property.type))
  const owners = entity.private?._owner?.map((s) => s.reference?.toString()) || []

  if (rigtsProperties.length > 0 && !owners.includes(entu.userStr) && !entu.systemUser) {
    throw createError({
      statusCode: 403,
      statusMessage: 'User not in _owner property'
    })
  }
}

// Validates each property's type name, system property value types, and _parent references
async function validatePropertyTypes (entu, properties, allowedTypes) {
  const systemPropertyValueTypes = {
    _type: 'reference',
    _parent: 'reference',
    _noaccess: 'reference',
    _viewer: 'reference',
    _expander: 'reference',
    _editor: 'reference',
    _owner: 'reference',
    _sharing: 'string',
    _inheritrights: 'boolean'
  }
  const allValueFields = ['string', 'number', 'boolean', 'reference', 'date', 'datetime']
  const refCheckedTypes = ['_type', '_owner', '_editor', '_viewer', '_expander', '_noaccess']

  // Batch-fetch all reference existence checks upfront
  const refCheckIds = properties
    .filter((p) => refCheckedTypes.includes(p.type) && p.reference)
    .map((p) => getObjectId(p.reference))

  const existingRefIds = new Set()

  if (refCheckIds.length > 0) {
    const found = await entu.db.collection('entity')
      .find({ _id: { $in: refCheckIds } }, { projection: { _id: true } })
      .toArray()

    for (const doc of found) existingRefIds.add(doc._id.toString())
  }

  for (let i = 0; i < properties.length; i++) {
    const property = properties[i]

    if (!property.type) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Property type not set'
      })
    }
    if (!/^\w+$/.test(property.type)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Property type must be alphanumeric'
      })
    }
    if (property.type.startsWith('_') && !allowedTypes.includes(property.type)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Property type can\'t begin with _'
      })
    }

    const expectedValueField = systemPropertyValueTypes[property.type]

    if (expectedValueField) {
      if (property[expectedValueField] === undefined || property[expectedValueField] === null) {
        throw createError({
          statusCode: 400,
          statusMessage: `Property ${property.type} must have ${expectedValueField} value`
        })
      }

      const disallowedFields = allValueFields.filter((f) => f !== expectedValueField)

      for (const field of disallowedFields) {
        if (property[field] !== undefined) {
          throw createError({
            statusCode: 400,
            statusMessage: `Property ${property.type} must only have ${expectedValueField} value`
          })
        }
      }

      if (property.type === '_sharing' && !['public', 'domain', 'private'].includes(property.string)) {
        throw createError({
          statusCode: 400,
          statusMessage: 'Property _sharing value must be public, domain or private'
        })
      }
    }
    else {
      const metaFields = ['type', '_id', 'language']
      const hasValue = Object.keys(property).some((k) => !metaFields.includes(k))

      if (!hasValue) {
        throw createError({
          statusCode: 400,
          statusMessage: 'Property must have at least one value'
        })
      }

      const hasFilename = property.filename !== undefined
      const hasFilesize = property.filesize !== undefined
      const hasFiletype = property.filetype !== undefined

      if ((hasFilename || hasFilesize || hasFiletype) && !(hasFilename && hasFilesize && hasFiletype)) {
        throw createError({
          statusCode: 400,
          statusMessage: 'File property must have filename, filesize and filetype'
        })
      }
    }

    if (property.language !== undefined) {
      if (typeof property.language !== 'string' || property.language.trim() === '') {
        throw createError({
          statusCode: 400,
          statusMessage: 'Property language must be a non-empty string'
        })
      }
    }

    if (property.type === '_parent' && property.reference) {
      const parent = await entu.db.collection('entity').findOne({
        _id: getObjectId(property.reference)
      }, {
        projection: {
          _id: false,
          'private._expander': true,
          'private._sharing': true,
          'private._inheritrights': true
        }
      })

      if (!parent) {
        throw createError({
          statusCode: 400,
          statusMessage: 'Entity in _parent property not found'
        })
      }

      const parentAccess = parent.private?._expander?.map((s) => s.reference?.toString()) || []

      if (!parentAccess.includes(entu.userStr) && !entu.systemUser) {
        throw createError({
          statusCode: 400,
          statusMessage: 'User not in parent _owner, _editor nor _expander property'
        })
      }
    }

    if (refCheckedTypes.includes(property.type) && property.reference) {
      if (!existingRefIds.has(getObjectId(property.reference).toString())) {
        throw createError({
          statusCode: 400,
          statusMessage: `Entity in ${property.type} property not found`
        })
      }
    }
  }
}

// Pushes default _parent entries based on the entity's _type definition
async function applyDefaultParents (entu, properties, createdDt) {
  const entityType = properties.find((x) => x.type === '_type' && x.reference)

  if (!entityType)
    return

  const defaultParents = await entu.db.collection('entity').findOne(
    { _id: getObjectId(entityType.reference), 'private.default_parent': { $exists: true } },
    { projection: { 'private.default_parent': true } }
  )

  if (defaultParents) {
    for (const parent of defaultParents.private.default_parent) {
      properties.push({
        type: '_parent',
        reference: parent.reference,
        created: { at: createdDt, by: entu.user || 'entu' }
      })
    }
  }
}

// Inherits _sharing and _inheritrights from parent entities
async function inheritParentProperties (entu, properties, createdDt) {
  const parentReferences = properties.filter((x) => x.type === '_parent' && x.reference).map((x) => x.reference)

  if (parentReferences.length === 0)
    return

  const needsSharing = !properties.some((x) => x.type === '_sharing')
  const needsInheritRights = !properties.some((x) => x.type === '_inheritrights')

  if (needsSharing || needsInheritRights) {
    const parents = await entu.db.collection('entity').find(
      { _id: { $in: parentReferences.map(getObjectId) } },
      { projection: { 'private._sharing': true, 'private._inheritrights': true } }
    ).toArray()

    if (needsSharing) {
      const parentSharings = parents.map((p) => p.private?._sharing?.at(0)?.string).filter(Boolean)

      if (parentSharings.includes('public')) {
        properties.push({ type: '_sharing', string: 'public', created: { at: createdDt, by: entu.user || 'entu' } })
      }
      else if (parentSharings.includes('domain')) {
        properties.push({ type: '_sharing', string: 'domain', created: { at: createdDt, by: entu.user || 'entu' } })
      }
    }

    if (needsInheritRights && parents.some((p) => p.private?._inheritrights?.at(0)?.boolean === true)) {
      properties.push({ type: '_inheritrights', boolean: true, created: { at: createdDt, by: entu.user || 'entu' } })
    }
  }
}

// Resolves a default value string to a Date — supports relative offsets like +1d, -2h, +1m
function resolveServerDate (defaultStr) {
  const match = defaultStr.match(/^([+-])(\d+)([hdwmy])$/)

  if (match) {
    const n = Number.parseInt(match[2], 10) * (match[1] === '+' ? 1 : -1)
    const d = new Date()

    if (match[3] === 'h')
      d.setHours(d.getHours() + n)
    else if (match[3] === 'd')
      d.setDate(d.getDate() + n)
    else if (match[3] === 'w')
      d.setDate(d.getDate() + n * 7)
    else if (match[3] === 'm')
      d.setMonth(d.getMonth() + n)
    else if (match[3] === 'y')
      d.setFullYear(d.getFullYear() + n)

    return d
  }

  return new Date(defaultStr)
}

// Pushes default property values from the entity type definition for any property not already provided
async function applyPropertyDefaults (entu, properties) {
  const entityType = properties.find((x) => x.type === '_type' && x.reference)

  if (!entityType)
    return

  const propDefs = await entu.db.collection('entity').find(
    {
      'private._parent.reference': getObjectId(entityType.reference),
      'private.default': { $exists: true }
    },
    { projection: { 'private.name': 1, 'private.type': 1, 'private.default': 1 } }
  ).toArray()

  for (const propDef of propDefs) {
    const name = propDef.private?.name?.at(0)?.string
    const type = propDef.private?.type?.at(0)?.string
    const defaultStr = propDef.private?.default?.at(0)?.string

    if (!name || !type || !defaultStr)
      continue
    if (['file', 'counter'].includes(type))
      continue
    if (properties.some((p) => p.type === name))
      continue

    const prop = { type: name }

    if (type === 'number')
      prop.number = Number(defaultStr)
    else if (type === 'boolean')
      prop.boolean = defaultStr.toLowerCase() === 'true'
    else if (type === 'date')
      prop.date = resolveServerDate(defaultStr)
    else if (type === 'datetime')
      prop.datetime = resolveServerDate(defaultStr)
    else if (type === 'reference')
      prop.reference = defaultStr
    else prop.string = String(defaultStr)

    properties.push(prop)
  }
}

// Inserts a new entity document and pushes _owner and _created system properties
async function createEntityRecord (entu, properties, createdDt) {
  const entity = await entu.db.collection('entity').insertOne({})
  const entityId = entity.insertedId

  if (entu.user) {
    properties.push({
      entity: entityId,
      type: '_owner',
      reference: entu.user,
      created: { at: createdDt, by: entu.user }
    })
    properties.push({
      entity: entityId,
      type: '_created',
      reference: entu.user,
      datetime: createdDt,
      created: { at: createdDt, by: entu.user }
    })
  }
  else {
    properties.push({
      entity: entityId,
      type: '_created',
      datetime: createdDt,
      created: { at: createdDt, by: 'entu' }
    })
  }

  return entityId
}

// Processes and inserts all properties, returning inserted pIds and replaced oldPIds
async function insertProperties (entu, entityId, properties, createdDt) {
  const pIds = []
  const oldPIds = []

  for (let i = 0; i < properties.length; i++) {
    const property = properties[i]
    let apiKey

    if (property._id) {
      oldPIds.push(getObjectId(property._id))

      delete property._id
    }
    if (property.reference) {
      property.reference = getObjectId(property.reference)
    }
    if (property.date) {
      property.date = new Date(property.date)
    }
    if (property.datetime) {
      property.datetime = new Date(property.datetime)
    }
    if (property.counter) {
      const nextCounter = await getNextCounterValue(entu, property)

      property.string = nextCounter.string
      property.number = nextCounter.number

      delete property.counter
    }
    if (property.type === 'entu_user' && property.string) {
      const { jwtSecret } = useRuntimeConfig()

      property.invite = jwt.sign({ db: entu.account, entityId: entityId.toString() }, jwtSecret, { expiresIn: '7d' })

      delete property.string
    }
    if (property.type === 'entu_api_key') {
      apiKey = Array.from(randomBytes(32), (byte) => charsForKey[byte % charsForKey.length]).join('')

      property.string = createHash('sha256').update(apiKey).digest('hex')
    }

    property.entity = entityId
    property.created = {
      at: createdDt,
      by: entu.user || 'entu'
    }

    const insertedProperty = await entu.db.collection('property').insertOne(property)
    const newProperty = { _id: insertedProperty.insertedId, ...property }

    delete newProperty.entity
    delete newProperty.created

    if (apiKey) {
      newProperty.string = apiKey
    }

    if (property.filename && property.filesize && property.filetype) {
      const contentDisposition = `inline;filename="${encodeURI(property.filename.replace('"', '\"'))}"`

      newProperty.upload = {
        url: await getSignedUploadUrl(entu.account, entityId, newProperty, contentDisposition, property.filetype),
        method: 'PUT',
        headers: {
          ACL: 'private',
          'Content-Disposition': contentDisposition,
          'Content-Length': property.filesize,
          'Content-Type': property.filetype
        }
      }
    }

    pIds.push(newProperty)
  }

  return { pIds, oldPIds }
}

// Returns the next counter string/number for a counter-type property
async function getNextCounterValue (entu, property) {
  const regex = /\d+(?!.*\d)/
  const add = typeof property.counter === 'number' ? property.counter : 1

  if (property.string) {
    const match = property.string.match(regex)

    if (match) {
      const number = Number.parseInt(match.at(0), 10)
      return { string: property.string.replace(regex, number), number }
    }
  }
  else {
    const lastProperty = await entu.db.collection('property')
      .find({ type: property.type, deleted: { $exists: false } })
      .sort({ number: -1, _id: -1 })
      .limit(1)
      .toArray()

    if (lastProperty.length === 0) {
      return { string: `${add}`, number: add }
    }

    const str = lastProperty.at(0).string
    const match = str.match(regex)

    if (match) {
      const number = Number.parseInt(match.at(0), 10) + add
      return { string: str.replace(regex, number), number }
    }
    else {
      return { string: `${str}${add}`, number: add }
    }
  }
}

// Soft-deletes replaced properties by setting their deleted field
async function markPropertiesDeleted (entu, entityId, oldPIds) {
  if (oldPIds.length === 0)
    return

  await entu.db.collection('property').updateMany({
    _id: { $in: oldPIds },
    entity: entityId,
    deleted: { $exists: false }
  }, {
    $set: {
      deleted: {
        at: new Date(),
        by: entu.user || 'entu'
      }
    }
  })
}

// Returns the public, domain, or private view of an entity based on user access rights
export async function cleanupEntity (entu, entity, _thumbnail) {
  if (!entity)
    return

  let result = { _id: entity._id }

  if (entu.userStr && entity.access?.map((x) => x.toString())?.includes(entu.userStr)) {
    result = { ...result, ...entity.private }
  }
  else if (entu.userStr && entity.access?.includes('domain')) {
    result = { ...result, ...entity.domain }
  }
  else if (entity.access?.includes('public')) {
    result = { ...result, ...entity.public }
  }
  else {
    return
  }

  if (_thumbnail && result.photo?.at(0)) {
    result._thumbnail = await getSignedDownloadUrl(entu.account, result._id, result.photo.at(0))
  }

  if (result.entu_api_key) {
    for (const k of result.entu_api_key) {
      k.string = '***'
    }
  }

  if (result.entu_user) {
    for (const u of result.entu_user) {
      if (u.invite) {
        u.invite = '***'
      }
      else if (u.email?.endsWith('@eesti.ee')) {
        u.email = u.email.replace('@eesti.ee', '')
      }
    }
  }

  if (result.entu_passkey) {
    for (const k of result.entu_passkey) {
      k.string = `${k.passkey_device || ''} ${k._id.toString().slice(-4).toUpperCase()}`.trim()
    }
  }

  if (!result._thumbnail) {
    delete result._thumbnail
  }

  return result
}
