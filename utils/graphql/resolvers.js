// Build the resolvers map for query, mutations, and special field types
export function buildResolvers (entityTypes, propsByTypeId) {
  const Query = {}
  const Mutation = {}

  for (const entityType of entityTypes) {
    const typeId = entityType._id
    const fieldName = toGqlFieldName(entityType.name)
    const propDefs = propsByTypeId[typeId.toString()] || []

    // Query: list entities of this type, with optional limit/skip/filter
    Query[fieldName] = async (_, args, { entu }) => {
      const filter = {
        'private._type.reference': typeId,
        access: entu.user ? { $in: [entu.user, 'domain', 'public'] } : 'public'
      }

      if (args.filter) {
        if (args.filter._id) {
          filter._id = getObjectId(args.filter._id)
        }

        const mongoFilter = buildMongoFilter(args.filter, propDefs)
        Object.assign(filter, mongoFilter)

        if (args.filter._search) {
          const terms = args.filter._search.toLowerCase().split(' ').filter(Boolean).map((t) => t.substring(0, 20))
          filter[entu.user ? 'search.private' : 'search.public'] = { $all: terms }
        }
      }

      const entities = await entu.db.collection('entity')
        .find(filter, { projection: { private: 1, domain: 1, public: 1, access: 1 } })
        .sort({ _id: 1 })
        .skip(args.skip || 0)
        .limit(args.limit || 100)
        .toArray()

      const cleaned = await Promise.all(entities.map((e) => cleanupEntity(entu, e, false)))
      return cleaned.filter(Boolean).map((e) => remapEntityForGraphQL(e, propDefs))
    }

    // Only add Create/Update if there are writable properties (matches SDL input type generation)
    const hasWritableProps = propDefs.some((p) =>
      !p.formula && !p.readonly && p.type !== 'counter' && p.type !== 'file'
    )

    if (!hasWritableProps) {
      // Delete-only type
      Mutation[`${fieldName}Delete`] = async (_, { id }, { entu }) => {
        if (!entu.user)
          throw new Error('Authentication required')
        const entityId = getObjectId(id)
        const entity = await entu.db.collection('entity').findOne(
          { _id: entityId },
          { projection: { _id: false, 'private._owner': true } }
        )
        if (!entity)
          throw new Error(`Entity ${id} not found`)
        const owners = (entity.private?._owner || []).map((s) => s.reference?.toString())
        if (!owners.includes(entu.userStr))
          throw new Error('User not in _owner property')
        await entu.db.collection('property').insertOne({
          entity: entityId,
          type: '_deleted',
          reference: entu.user,
          datetime: new Date(),
          created: { at: new Date(), by: entu.user }
        })
        await aggregateEntity(entu, entityId)
        await triggerWebhooks(entu, entityId, 'entity-delete-webhook')
        const referrers = await entu.db.collection('property').aggregate([
          { $match: { reference: entityId, deleted: { $exists: false } } },
          { $group: { _id: '$entity' } }
        ]).toArray()
        await entu.db.collection('property').updateMany(
          { reference: entityId, deleted: { $exists: false } },
          { $set: { deleted: { at: new Date(), by: entu.user } } }
        )
        await addAggregateQueue(entu, referrers.map((r) => r._id))
        return true
      }
      continue
    }

    // Create mutation
    Mutation[`${fieldName}Create`] = async (_, { input }, { entu }) => {
      if (!entu.user)
        throw new Error('Authentication required')

      const properties = [
        { type: '_type', reference: typeId.toString() },
        ...mapInputToProps(input, propDefs)
      ]

      const { _id } = await setEntity(entu, undefined, properties)
      await triggerWebhooks(entu, _id, 'entity-add-webhook')

      const entity = await entu.db.collection('entity').findOne({ _id })
      const cleaned = await cleanupEntity(entu, entity, false)
      return remapEntityForGraphQL(cleaned, propDefs)
    }

    // Update mutation
    Mutation[`${fieldName}Update`] = async (_, { id, input }, { entu }) => {
      if (!entu.user)
        throw new Error('Authentication required')

      const entityId = getObjectId(id)
      const newProps = mapInputToProps(input, propDefs)

      if (newProps.length === 0)
        throw new Error('At least one non-null property value is required for update')

      // Find existing props for the types being updated, to enable full-replace semantics
      const inputPropNames = [...new Set(newProps.map((p) => p.type))]
      const existingProps = await entu.db.collection('property').find({
        entity: entityId,
        type: { $in: inputPropNames },
        deleted: { $exists: false }
      }).toArray()

      // Group old _ids by type
      const oldIdsByType = {}
      for (const p of existingProps) {
        if (!oldIdsByType[p.type])
          oldIdsByType[p.type] = []
        oldIdsByType[p.type].push(p._id)
      }

      // Tag old prop _id onto each new prop for 1:1 replacement inside setEntity
      const taggedProps = newProps.map((prop) => {
        const oldIds = oldIdsByType[prop.type]
        if (oldIds && oldIds.length > 0) {
          return { ...prop, _id: oldIds.shift().toString() }
        }
        return prop
      })

      // Delete any remaining old props beyond the count of new props (list-shrink case)
      const extraOldIds = Object.values(oldIdsByType).flat()
      if (extraOldIds.length > 0) {
        await entu.db.collection('property').updateMany(
          { _id: { $in: extraOldIds }, entity: entityId, deleted: { $exists: false } },
          { $set: { deleted: { at: new Date(), by: entu.user } } }
        )
      }

      // setEntity validates access, inserts props (deleting old via _id tags), and re-aggregates
      await setEntity(entu, entityId, taggedProps)
      await triggerWebhooks(entu, entityId, 'entity-edit-webhook')

      const entity = await entu.db.collection('entity').findOne({ _id: entityId })
      const cleaned = await cleanupEntity(entu, entity, false)
      return remapEntityForGraphQL(cleaned, propDefs)
    }

    // Delete mutation
    Mutation[`${fieldName}Delete`] = async (_, { id }, { entu }) => {
      if (!entu.user)
        throw new Error('Authentication required')

      const entityId = getObjectId(id)

      const entity = await entu.db.collection('entity').findOne(
        { _id: entityId },
        { projection: { _id: false, 'private._owner': true } }
      )

      if (!entity)
        throw new Error(`Entity ${id} not found`)

      const owners = (entity.private?._owner || []).map((s) => s.reference?.toString())
      if (!owners.includes(entu.userStr))
        throw new Error('User not in _owner property')

      await entu.db.collection('property').insertOne({
        entity: entityId,
        type: '_deleted',
        reference: entu.user,
        datetime: new Date(),
        created: { at: new Date(), by: entu.user }
      })

      await aggregateEntity(entu, entityId)
      await triggerWebhooks(entu, entityId, 'entity-delete-webhook')

      const referrers = await entu.db.collection('property').aggregate([
        { $match: { reference: entityId, deleted: { $exists: false } } },
        { $group: { _id: '$entity' } }
      ]).toArray()

      await entu.db.collection('property').updateMany(
        { reference: entityId, deleted: { $exists: false } },
        { $set: { deleted: { at: new Date(), by: entu.user } } }
      )

      await addAggregateQueue(entu, referrers.map((r) => r._id))

      return true
    }
  }

  const fileUrlResolver = {
    url: async (obj, _, { entu }) => {
      if (!obj._entityId)
        return null
      return getSignedDownloadUrl(entu.account, obj._entityId, obj)
    }
  }
  const dateResolver = {
    date: (obj) => (obj.date instanceof Date ? obj.date.toISOString().split('T')[0] : obj.date)
  }
  const datetimeResolver = {
    datetime: (obj) => (obj.datetime instanceof Date ? obj.datetime.toISOString() : obj.datetime)
  }

  return {
    Query,
    Mutation,
    FileValue: fileUrlResolver,
    FileValueLanguage: fileUrlResolver,
    DateValue: dateResolver,
    DateValueLanguage: dateResolver,
    DatetimeValue: datetimeResolver,
    DatetimeValueLanguage: datetimeResolver
  }
}

// Maps GraphQL input object to an array of Entu property objects for setEntity
export function mapInputToProps (input, propDefs) {
  const props = []

  for (const [gqlField, value] of Object.entries(input)) {
    if (value === undefined || value === null)
      continue

    const propDef = propDefs.find((p) => toGqlFieldName(p.name) === gqlField)
    if (!propDef)
      continue

    if (propDef.multilingual) {
      const arr = Array.isArray(value) ? value : [value]
      for (const item of arr) {
        if (item && item.string !== undefined) {
          props.push({ type: propDef.name, string: item.string, language: item.language })
        }
      }
    }
    else if (propDef.list) {
      const arr = Array.isArray(value) ? value : [value]
      for (const item of arr) {
        if (item !== null && item !== undefined) {
          props.push(makeScalarProp(propDef.name, propDef.type, item))
        }
      }
    }
    else {
      props.push(makeScalarProp(propDef.name, propDef.type, value))
    }
  }

  return props
}

function makeScalarProp (propName, entuType, value) {
  const prop = { type: propName }

  switch (entuType) {
    case 'string':
    case 'text':
      prop.string = String(value)
      break
    case 'number':
      prop.number = Number(value)
      break
    case 'boolean':
      prop.boolean = Boolean(value)
      break
    case 'reference':
      prop.reference = String(value)
      break
    case 'date':
      prop.date = String(value)
      break
    case 'datetime':
      prop.datetime = String(value)
      break
    default:
      prop.string = String(value)
  }

  return prop
}

// System property names included in every entity output type
const SYSTEM_PROP_NAMES = ['_type', '_parent', '_owner', '_editor', '_expander', '_viewer', '_sharing', '_inheritrights']
// These system properties return a single value object (not an array)
const SYSTEM_PROP_SINGLES = new Set(['_inheritrights'])

// Remaps entity from cleanupEntity (using original DB prop names) to GraphQL field names.
// list:true → array, list:false → single value (first element or null).
// Stamps _entityId onto file value objects for signed URL generation.
function remapEntityForGraphQL (entity, propDefs) {
  if (!entity)
    return null

  const result = { _id: entity._id }

  // Map system properties
  for (const sp of SYSTEM_PROP_NAMES) {
    if (entity[sp] === undefined)
      continue
    if (sp === '_sharing') {
      result[sp] = entity[sp][0]?.string || null
    }
    else if (SYSTEM_PROP_SINGLES.has(sp)) {
      result[sp] = entity[sp][0] || null
    }
    else {
      result[sp] = entity[sp]
    }
  }

  for (const propDef of propDefs) {
    const gqlField = toGqlFieldName(propDef.name)
    const values = entity[propDef.name]

    if (values === undefined)
      continue

    if (propDef.type === 'file') {
      const stamped = values.map((f) => ({ ...f, _entityId: entity._id }))
      result[gqlField] = propDef.list ? stamped : (stamped[0] || null)
    }
    else {
      result[gqlField] = propDef.list ? values : (values[0] || null)
    }
  }

  return result
}
