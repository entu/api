const reservedDatabases = [
  'admin',
  'api',
  'argo',
  'argoroots',
  'arx_raamat',
  'arx',
  'auth',
  'billing',
  'collection',
  'config',
  'database',
  'dev',
  'develop',
  'eka',
  'entity',
  'local',
  'new',
  'property',
  'raamatukogu',
  'stripe',
  'template',
  'test'
]

const defaultTypes = [
  'database',
  'entity',
  'menu',
  'person',
  'plugin',
  'property'
]

// Returns true if the name passes all rules (length, reserved list, entu_ prefix) and does not already exist as a MongoDB database
export async function isAvailableDatabase (name, db) {
  const sanitized = formatDatabaseName(name)

  if (
    !sanitized
    || sanitized.length < 4
    || sanitized.length > 12
    || sanitized.startsWith('entu_')
    || reservedDatabases.includes(sanitized)
  ) {
    return false
  }

  const { databases } = await db.admin().listDatabases()

  return !databases.some((x) => x.name === sanitized)
}

// Sets up a brand new database: indexes, template entities (two-pass: non-ref then ref), person, database, rights and final aggregation
export async function initializeNewDatabase (entu, reservation, billingCustomerId) {
  await createDatabaseIndexes(entu.db)

  // Fetch all template entities
  const [templateTypes, templateMenus, templatePlugins] = await Promise.all([
    getTypes(),
    getMenus(),
    getPlugins()
  ])

  const allTemplateEntities = [...templateTypes, ...templateMenus, ...templatePlugins]

  // Find template entity type IDs for person and database (used when building their ref props)
  const templatePersonTypeId = allTemplateEntities.find((e) => e.type === 'entity' && e.name === 'person')?._id
  const templateDatabaseTypeId = allTemplateEntities.find((e) => e.type === 'entity' && e.name === 'database')?._id

  // setEntity only allows these underscore-prefixed property types
  const allowedSystemTypes = new Set(['_type', '_parent', '_noaccess', '_viewer', '_expander', '_editor', '_owner', '_sharing', '_inheritrights'])

  // Build entity list: template entities split into non-ref and ref props
  const entities = allTemplateEntities.map((e) => {
    const importableProps = e.properties.filter((p) => !p.type.startsWith('_') || allowedSystemTypes.has(p.type))

    return {
      oldId: e._id,
      newId: null,
      nonRefProps: importableProps.filter((p) => p.reference === undefined),
      refProps: importableProps.filter((p) => p.reference !== undefined)
    }
  })

  // Person entity (non-ref props; _type + _owner added in pass 2)
  const personNonRefProps = [
    { type: '_sharing', string: 'private' },
    { type: 'entu_user', string: entu.account }
  ]

  if (reservation.name) {
    const nameParts = reservation.name.trim().split(/\s+/)
    const forename = nameParts.slice(0, -1).join(' ') || nameParts.at(0)
    const surname = nameParts.length > 1 ? nameParts.at(-1) : null

    personNonRefProps.push({ type: 'forename', string: forename })
    if (surname)
      personNonRefProps.push({ type: 'surname', string: surname })
  }

  if (reservation.email)
    personNonRefProps.push({ type: 'email', string: reservation.email })

  const personEntry = { oldId: null, newId: null, key: 'person', nonRefProps: personNonRefProps, refProps: [] }

  // Database entity (non-ref props; _type + _editor added in pass 2)
  const databaseNonRefProps = [
    { type: '_sharing', string: 'domain' },
    { type: '_inheritrights', boolean: true },
    { type: 'name', string: entu.account }
  ]

  if (reservation.email)
    databaseNonRefProps.push({ type: 'email', string: reservation.email })
  if (reservation.plan)
    databaseNonRefProps.push({ type: 'plan', string: reservation.plan })
  if (billingCustomerId)
    databaseNonRefProps.push({ type: 'billing_customer_id', string: billingCustomerId })

  const databaseEntry = { oldId: null, newId: null, key: 'database', nonRefProps: databaseNonRefProps, refProps: [] }

  entities.push(personEntry, databaseEntry)

  // Pass 1: create all entities with only non-ref properties, build idMap (template oldId → new _id)
  const idMap = new Map()

  await Promise.all(entities.map(async (entry) => {
    if (entry.nonRefProps.length === 0)
      return

    const { _id } = await setEntity(entu, null, entry.nonRefProps, { skipTypeRequired: true })

    entry.newId = _id

    if (entry.oldId)
      idMap.set(entry.oldId.toString(), _id)
  }))

  const personId = personEntry.newId

  // Read invite token — generated when entu_user was set in pass 1
  const personDoc = await entu.db.collection('entity').findOne(
    { _id: personId },
    { projection: { 'private.entu_user.invite': true } }
  )
  const inviteToken = personDoc.private.entu_user.at(0).invite

  const databaseId = databaseEntry.newId

  // Pass 2: add reference properties (remapped via idMap) to template entities
  await Promise.all(entities.map(async (entry) => {
    if (entry.refProps.length === 0 || !entry.newId)
      return

    const remapped = entry.refProps
      .map((p) => ({ ...p, reference: idMap.get(p.reference.toString()) }))
      .filter((p) => p.reference)

    if (remapped.length > 0) {
      await setEntity(entu, entry.newId, remapped)
    }
  }))

  // Person: add _type (from template) and _owner (self-reference)
  const personRefProps = [{ type: '_owner', reference: personId }]

  if (templatePersonTypeId && idMap.has(templatePersonTypeId.toString())) {
    personRefProps.unshift({ type: '_type', reference: idMap.get(templatePersonTypeId.toString()) })
  }

  await setEntity(entu, personId, personRefProps)

  // Database: add _type (from template) and _editor (person)
  const databaseRefProps = [{ type: '_editor', reference: personId }]

  if (templateDatabaseTypeId && idMap.has(templateDatabaseTypeId.toString())) {
    databaseRefProps.unshift({ type: '_type', reference: idMap.get(templateDatabaseTypeId.toString()) })
  }

  await setEntity(entu, databaseId, databaseRefProps)

  // Add database as parent to all entities without one
  const noParents = await entu.db.collection('entity').find({
    _id: { $ne: databaseId },
    'private._parent.reference': { $exists: false }
  }, { projection: { _id: true }, sort: { _id: 1 } }).toArray()

  await Promise.all(noParents.map((x) =>
    setEntity(entu, x._id, [{ type: '_parent', reference: databaseId }])
  ))

  // Add person as owner to entity types, menus and plugins
  const noRights = await entu.db.collection('entity').find({
    $or: [{
      'private._type.string': 'entity',
      'private.system._id': { $exists: false }
    }, {
      'private._type.string': 'menu'
    }, {
      'private._type.string': 'plugin'
    }]
  }, { projection: { _id: true }, sort: { _id: 1 } }).toArray()

  await Promise.all(noRights.map((x) =>
    setEntity(entu, x._id, [{ type: '_owner', reference: personId }])
  ))

  // Final aggregation to resolve any cross-entity reference chains
  const allEntities = await entu.db.collection('entity').find({}, { sort: { _id: 1 } }).toArray()

  await Promise.all(allEntities.map((x) => aggregateEntity(entu, x._id)))

  return inviteToken
}

// Creates all required indexes on entity, property and stats collections for a new database
async function createDatabaseIndexes (db) {
  await Promise.all([
    db.collection('entity').createIndexes([
      { key: { 'private._parent.reference': 1 } },
      { key: { 'private._reference.reference': 1 } },
      { key: { 'private._type.string': 1 } },
      { key: { 'private.add_from.reference': 1 } },
      { key: { 'private.entu_api_key.string': 1 } },
      { key: { 'private.entu_passkey.passkey_id': 1 } },
      { key: { 'private.entu_user.invite': 1 } },
      { key: { 'private.entu_user.string': 1 } },
      { key: { 'private.entu_user.uid': 1, 'private.entu_user.provider': 1 } },
      { key: { 'private.formula.string': 1 }, sparse: true },
      { key: { 'private.name.string': 1 } },
      { key: { 'search.domain': 1 } },
      { key: { 'search.private': 1 } },
      { key: { 'search.public': 1 } },
      { key: { access: 1 } },
      { key: { queued: 1 }, sparse: true }
    ]),

    db.collection('property').createIndexes([
      { key: { 'created.by': 1 } },
      { key: { 'deleted.by': 1 } },
      { key: { deleted: 1 } },
      { key: { entity: 1, type: 1, deleted: 1 } },
      { key: { filesize: 1 } },
      { key: { reference: 1, deleted: 1 } },
      { key: { type: 1, deleted: 1, number: -1 } }
    ]),

    db.collection('stats').createIndex(
      { date: 1, function: 1 },
      { unique: true }
    )
  ])
}

// Fetches all default entity type definitions from the template database
async function getTypes () {
  const templateDb = await connectDb('template')
  const entities = await templateDb.collection('entity').find({
    'private._type.string': 'entity',
    'private.name.string': { $in: defaultTypes }
  }, { projection: { _id: true } }).toArray()

  const result = await Promise.all(entities.map((x) =>
    getEntity(templateDb, x._id, ['_parent'])
  ))

  return result.flat()
}

// Fetches all menu definitions matching the default types from the template database
async function getMenus () {
  const typesFilter = defaultTypes.map((x) => ({ 'private.query.string': { $regex: `.*_type.string=${x}.*` } }))

  typesFilter.push({ 'private.query.string': { $regex: '.*/billing.*' } })

  const templateDb = await connectDb('template')
  const entities = await templateDb.collection('entity').find({
    'private._type.string': 'menu',
    $or: typesFilter
  }, { projection: { _id: true } }).toArray()

  const result = await Promise.all(entities.map((x) =>
    getEntity(templateDb, x._id, ['_parent'])
  ))

  return result.flat()
}

// Fetches all plugin definitions from the template database
async function getPlugins () {
  const templateDb = await connectDb('template')
  const entities = await templateDb.collection('entity').find({
    'private._type.string': 'plugin'
  }, { projection: { _id: true } }).toArray()

  const result = await Promise.all(entities.map((x) =>
    getEntity(templateDb, x._id, ['_parent'])
  ))

  return result.flat()
}

// Reads a single entity and its properties from the template database, excluding specified property types and system properties
async function getEntity (db, _id, noProperties = []) {
  const [entity, properties, childs] = await Promise.all([
    db.collection('entity').findOne({ _id }, {
      projection: {
        _id: true,
        'private._type.string': true,
        'private.name.string': true
      }
    }),
    db.collection('property').find({
      entity: _id,
      deleted: { $exists: false },
      type: {
        $nin: [
          '_mid',
          ...noProperties
        ]
      }
    }, {
      projection: {
        _id: false,
        entity: false
      }
    }).toArray(),
    getChilds(db, _id)
  ])

  return [
    {
      _id: entity._id,
      type: entity.private?._type?.at(0)?.string,
      name: entity.private?.name?.at(0)?.string,
      properties
    },
    ...childs.flat()
  ]
}

// Recursively fetches child entities from the template database, excluding legacy entity types not used in new databases
async function getChilds (db, _id) {
  const childs = await db.collection('entity').find({
    'private._parent.reference': _id,
    'private._type.string': {
      $nin: [
        'acceptance_report',
        'gender',
        'inventory_number',
        'invoice',
        'mahakandmisakt'
      ]
    }
  }, { projection: { _id: true } }).toArray()

  return await Promise.all(childs.map((child) =>
    getEntity(db, child._id)
  ))
}
