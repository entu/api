import { createHash } from 'node:crypto'

// Recomputes and saves the aggregated entity with computed fields, rights, and search indexes
export async function aggregateEntity (entu, entityId) {
  const entity = await entu.db.collection('entity').findOne({ _id: entityId }, {
    projection: {
      aggregated: true,
      hash: true,
      'private.name': true,
      'private._type': true,
      'private._parent': true,
      'private._reference': true,
      'private._noaccess': true,
      'private._viewer': true,
      'private._expander': true,
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

  // Check for deletion first — avoids fetching all properties when entity is being deleted
  const isDeleted = await entu.db.collection('property').countDocuments(
    { entity: entityId, type: '_deleted', deleted: { $exists: false } },
    { limit: 1 }
  )

  if (isDeleted) {
    await entu.db.collection('entity').deleteOne({ _id: entityId })

    // console.log(`DELETED ${entu.account} ${entityId}`)

    return {
      account: entu.account,
      entity: entityId,
      deleted: true,
      message: 'Entity is deleted'
    }
  }

  const properties = await entu.db.collection('property').find({ entity: entityId, deleted: { $exists: false } }).toArray()

  const newEntity = await propertiesToEntity(entu, properties)

  if (newEntity.private._parent) {
    newEntity.domain._parent = newEntity.private._parent
    newEntity.public._parent = newEntity.private._parent
  }

  if (newEntity.private._sharing) {
    newEntity.domain._sharing = newEntity.private._sharing
    newEntity.public._sharing = newEntity.private._sharing
  }

  // get info from type
  if (newEntity.private._type) {
    newEntity.domain._type = newEntity.private._type
    newEntity.public._type = newEntity.private._type

    if (newEntity.private._type.at(0)?.reference) {
      // get entity definition's _sharing and property definitions in parallel
      const [definitionEntity, definition] = await Promise.all([
        entu.db.collection('entity').findOne({
          _id: newEntity.private._type.at(0).reference
        }, {
          projection: { 'private._sharing': true }
        }),
        entu.db.collection('entity').aggregate([
          {
            $match: {
              'private._parent.reference': newEntity.private._type.at(0).reference,
              'private._type.string': 'property',
              'private.name.string': { $exists: true }
            }
          },
          {
            $project: {
              _id: false,
              name: { $arrayElemAt: ['$private.name.string', 0] },
              sharing: { $arrayElemAt: ['$private._sharing.string', 0] },
              search: { $arrayElemAt: ['$private.search.boolean', 0] },
              formula: { $arrayElemAt: ['$private.formula.string', 0] }
            }
          }
        ]).toArray()
      ])

      const definitionSharing = definitionEntity?.private?._sharing?.at(0)?.string

      // Two-pass formula evaluation: pass 1 seeds values, pass 2 resolves inter-formula dependencies
      // (e.g. formula A referencing formula B on the same entity — B must be computed before A reads it)
      for (let pass = 0; pass < 2; pass++) {
        for (let d = 0; d < definition.length; d++) {
          if (!definition[d].formula)
            continue

          const formulaValue = await formula(entu, definition[d].formula, entityId, newEntity.private)

          if (formulaValue) {
            newEntity.private[definition[d].name] = [formulaValue]
          }
        }
      }

      // Apply sharing, search indexing, and domain/public visibility after all formula values are stable
      for (let d = 0; d < definition.length; d++) {
        let sharing = definition[d].sharing

        if (!definitionSharing) {
          sharing = undefined
        }
        else if (definitionSharing === 'domain' && definition[d].sharing === 'public') {
          sharing = 'domain'
        }
        // console.log(definition[d].name, definitionSharing, definition[d].sharing, sharing)

        const dValue = newEntity.private[definition[d].name]

        if (definition[d].search && dValue) {
          const valueArray = await getValueArray(entu, dValue)

          newEntity.search.private = [
            ...(newEntity.search.private || []),
            ...valueArray
          ]

          if (sharing === 'domain') {
            newEntity.search.domain = [
              ...(newEntity.search.domain || []),
              ...valueArray
            ]
          }

          if (sharing === 'public') {
            newEntity.search.public = [
              ...(newEntity.search.public || []),
              ...valueArray
            ]
          }
        }

        if (sharing === 'domain' && dValue) {
          newEntity.domain[definition[d].name] = dValue
        }

        if (sharing === 'public' && dValue) {
          newEntity.domain[definition[d].name] = dValue
          newEntity.public[definition[d].name] = dValue
        }
      }
    }
    else {
      loggerError('No type reference', entu, [`entity:${entityId}`])
    }
  }
  else {
    loggerError(`No type ${newEntity.private._type}`, entu, [`entity:${entityId}`])
  }

  // get and set parent rights
  let parentRights = {}
  if (newEntity.private._parent?.length > 0 && newEntity.private._inheritrights?.at(0)?.boolean === true) {
    parentRights = await getParentRights(entu, newEntity.private._parent)

    if (parentRights._viewer) {
      newEntity.private._parent_viewer = uniqBy(parentRights._viewer, (x) => x.reference.toString())
    }
    if (parentRights._expander) {
      newEntity.private._parent_expander = uniqBy(parentRights._expander, (x) => x.reference.toString())
    }
    if (parentRights._editor) {
      newEntity.private._parent_editor = uniqBy(parentRights._editor, (x) => x.reference.toString())
    }
    if (parentRights._owner) {
      newEntity.private._parent_owner = uniqBy(parentRights._owner, (x) => x.reference.toString())
    }
  }

  // combine rights
  const noRights = newEntity.private._noaccess?.map((x) => x.reference.toString())

  newEntity.private._owner = uniqBy([
    ...(parentRights._owner || []),
    ...(newEntity.private._owner || [])
  ], (x) => [x.reference.toString(), x.inherited || false].join('-')).filter((x) => !noRights?.includes(x.reference.toString()))

  newEntity.private._editor = uniqBy([
    ...(parentRights._editor || []),
    ...(newEntity.private._editor || []),
    ...(newEntity.private._owner || [])
  ], (x) => [x.reference.toString(), x.inherited || false].join('-')).filter((x) => !noRights?.includes(x.reference.toString()))

  newEntity.private._expander = uniqBy([
    ...(parentRights._expander || []),
    ...(newEntity.private._expander || []),
    ...(newEntity.private._editor || [])
  ], (x) => [x.reference.toString(), x.inherited || false].join('-')).filter((x) => !noRights?.includes(x.reference.toString()))

  newEntity.private._viewer = uniqBy([
    ...(parentRights._viewer || []),
    ...(newEntity.private._viewer || []),
    ...(newEntity.private._expander || [])
  ], (x) => [x.reference.toString(), x.inherited || false].join('-')).filter((x) => !noRights?.includes(x.reference.toString()))

  const { _noaccess, _viewer, _expander, _editor, _owner } = combineRights({
    _noaccess: newEntity.private._noaccess,
    _viewer: newEntity.private._viewer,
    _expander: newEntity.private._expander,
    _editor: newEntity.private._editor,
    _owner: newEntity.private._owner
  })

  newEntity.access = getAccessArray(newEntity)

  if (!newEntity.access?.length) {
    delete newEntity.access
  }

  if (!_noaccess?.length) {
    delete newEntity.private._noaccess
  }
  else {
    newEntity.private._noaccess = _noaccess
  }
  if (!_viewer?.length) {
    delete newEntity.private._viewer
  }
  else {
    newEntity.private._viewer = _viewer
  }
  if (!_expander?.length) {
    delete newEntity.private._expander
  }
  else {
    newEntity.private._expander = _expander
  }
  if (!_editor?.length) {
    delete newEntity.private._editor
  }
  else {
    newEntity.private._editor = _editor
  }
  if (!_owner?.length) {
    delete newEntity.private._owner
  }
  else {
    newEntity.private._owner = _owner
  }

  if (!newEntity.private._parent_viewer?.length) {
    delete newEntity.private._parent_viewer
  }
  if (!newEntity.private._parent_expander?.length) {
    delete newEntity.private._parent_expander
  }
  if (!newEntity.private._parent_editor?.length) {
    delete newEntity.private._parent_editor
  }
  if (!newEntity.private._parent_owner?.length) {
    delete newEntity.private._parent_owner
  }

  if (newEntity.private?._sharing?.at(0)?.string !== 'domain' || Object.keys(newEntity.domain).length === 0) {
    delete newEntity.domain
  }

  if (newEntity.private?._sharing?.at(0)?.string !== 'public' || Object.keys(newEntity.public).length === 0) {
    delete newEntity.public
  }

  if (newEntity.search?.private?.length > 0) {
    newEntity.search.private = makeSearchArray(newEntity.search.private)
  }

  if (newEntity.search?.domain?.length > 0 || newEntity.search?.public?.length > 0) {
    newEntity.search.domain = makeSearchArray([...newEntity.search.domain || [], ...newEntity.search.public || []])
  }

  if (newEntity.search?.public?.length > 0) {
    newEntity.search.public = makeSearchArray(newEntity.search.public)
  }

  if (!newEntity.search?.private && !newEntity.search?.domain && !newEntity.search?.public) {
    delete newEntity.search
  }

  newEntity.hash = getEntityHash(newEntity.private)

  await entu.db.collection('entity').replaceOne({ _id: entityId }, newEntity, { upsert: true })

  const sqsLength = await startRelativeAggregation(entu, entity, newEntity)

  if (sqsLength > 0) {
    logger(`Added ${sqsLength} entities to aggregation`, entu, [`entity:${entityId}`])
  }

  return {
    account: entu.account,
    entity: entityId,
    queued: sqsLength,
    message: 'Entity is aggregated'
  }
}

// Converts a flat properties array into a structured entity object
async function propertiesToEntity (entu, properties) {
  const entity = {
    aggregated: new Date(),
    private: {},
    domain: {},
    public: {},
    access: [],
    search: {}
  }

  // Batch-fetch all referenced entities in one query instead of one findOne() per property
  const refIds = properties.filter((p) => p.reference).map((p) => p.reference)
  const refMap = new Map()

  if (refIds.length > 0) {
    const refDocs = await entu.db.collection('entity').find(
      { _id: { $in: refIds } },
      { projection: { 'private.name': true, 'private._type': true } }
    ).toArray()

    for (const doc of refDocs) {
      refMap.set(doc._id.toString(), doc)
    }
  }

  for (let n = 0; n < properties.length; n++) {
    const prop = properties[n]
    let cleanProp = { ...prop }
    delete cleanProp.entity
    delete cleanProp.type
    delete cleanProp.created
    delete cleanProp.search
    delete cleanProp.public

    if (!entity.private[prop.type]) {
      entity.private[prop.type] = []
    }

    if (prop.reference) {
      const referenceEntity = refMap.get(prop.reference.toString())

      if (referenceEntity) {
        cleanProp = { ...cleanProp, property_type: prop.type, string: referenceEntity.private?.name?.at(0).string, entity_type: referenceEntity.private?._type?.at(0).string }
      }

      if (!prop.type.startsWith('_')) {
        if (entity.private._reference) {
          entity.private._reference = [...entity.private._reference, cleanProp]
        }
        else {
          entity.private._reference = [cleanProp]
        }
      }
    }

    entity.private[prop.type] = [...entity.private[prop.type], cleanProp]
  }

  return entity
}

// Generates all unique substrings of value strings for full-text search indexing
function makeSearchArray (array) {
  if (!array || array.length === 0)
    return []

  const result = new Set()

  for (const str of array) {
    const words = `${str}`.toLowerCase().split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean)

    for (const word of words) {
      // Generate all substrings up to 20 characters long
      for (let startIndex = 0; startIndex < word.length; startIndex++) {
        const maxEndIndex = Math.min(word.length, startIndex + 20)

        for (let endIndex = startIndex + 1; endIndex <= maxEndIndex; endIndex++) {
          result.add(word.slice(startIndex, endIndex))
        }
      }
    }
  }

  return [...result].sort()
}

// Computes an MD5 hash of entity private properties to detect changes
function getEntityHash (obj) {
  const ids = []

  for (const [key, arr] of Object.entries(obj)) {
    for (const item of arr) {
      if (item._id) {
        ids.push(item._id.toString())
      }
      else if (item.string) {
        const hash = createHash('md5').update(`${key}: ${item.string}`).digest('hex')
        ids.push(hash)
      }
      else {
        const hash = createHash('md5').update(JSON.stringify(item)).digest('hex')
        ids.push(hash)
      }
    }
  }

  const joined = ids.sort().join(',')

  return createHash('md5').update(joined).digest('hex')
}

// Returns the subset of entityIds whose entity type has at least one formula property definition
async function filterEntitiesWithFormulas (entu, entityIds) {
  if (!entityIds || entityIds.length === 0)
    return []

  const result = await entu.db.collection('entity').aggregate([
    {
      $match: {
        _id: { $in: entityIds },
        'private._type.reference': { $exists: true }
      }
    },
    {
      $project: {
        typeRef: { $arrayElemAt: ['$private._type.reference', 0] }
      }
    },
    {
      $lookup: {
        from: 'entity',
        let: { typeId: '$typeRef' },
        pipeline: [
          {
            $match: {
              'private._type.string': 'property',
              'private.formula.string': { $exists: true },
              $expr: {
                $in: [
                  '$$typeId',
                  {
                    $map: {
                      input: { $ifNull: ['$private._parent', []] },
                      as: 'p',
                      in: '$$p.reference'
                    }
                  }
                ]
              }
            }
          },
          { $limit: 1 },
          { $project: { _id: 1 } }
        ],
        as: 'formulaDefs'
      }
    },
    { $match: { 'formulaDefs.0': { $exists: true } } },
    { $project: { _id: 1 } }
  ]).toArray()

  return result.map((x) => x._id)
}

// Queues related entities for re-aggregation when name, rights, or formula-relevant data changes
async function startRelativeAggregation (entu, oldEntity, newEntity) {
  let ids = []

  // Check if entity has changed — if not, nothing to propagate
  if (Boolean(oldEntity.hash) && oldEntity.hash === newEntity.hash)
    return 0

  // Collect referrer IDs once (entities whose properties point to this entity).
  // Reused for both name-change propagation and formula Case 2 below.
  const referrerIds = await entu.db.collection('property').distinct(
    'entity',
    { reference: oldEntity._id, deleted: { $exists: false } }
  )

  // Check if name has changed → queue ALL referrers (they cache the name string)
  const oldName = oldEntity.private?.name?.map((x) => x.string || '') || []
  const newName = newEntity.private?.name?.map((x) => x.string || '') || []
  oldName.sort()
  newName.sort()

  if (oldName.join('|') !== newName.join('|')) {
    // logger(`Aggregation - Name changed`, entu, [`entity:${oldEntity._id}`])
    ids = [...ids, ...referrerIds]
  }

  // Check if rights have changed → queue children with _inheritrights
  const rightProperties = ['_noaccess', '_viewer', '_expander', '_editor', '_owner']
  const oldRights = rightProperties.map((type) => oldEntity.private?.[type]?.map((x) => `${type}:${x.reference}`) || []).flat()
  const newRights = rightProperties.map((type) => newEntity.private?.[type]?.map((x) => `${type}:${x.reference}`) || []).flat()
  oldRights.sort()
  newRights.sort()

  if (oldRights.join('|') !== newRights.join('|')) {
    const childs = await entu.db.collection('entity').find({
      'private._parent.reference': oldEntity._id,
      'private._inheritrights.boolean': true
    }, {
      projection: { _id: true }
    }).toArray()

    // logger(`Aggregation - Rights changed`, entu, [`entity:${oldEntity._id}`])
    ids = [...ids, ...childs.map((x) => x._id)]
  }

  // Formula Case 1: Queue parents of X that have formula properties.
  // Rationale: parents may have _child.* formulas that read X's data.
  // Includes old parents (pre-edit) to handle the case where X's _parent changed.
  const newParentIds = newEntity.private?._parent?.map((x) => x.reference) || []
  const oldParentIds = oldEntity.private?._parent?.map((x) => x.reference) || []
  const allParentIds = uniqBy([...newParentIds, ...oldParentIds], (x) => x.toString())

  // Formula Case 3: Queue entities that this entity references (via non-system properties).
  // Rationale: referenced entities may have _referrer.* formulas that read this entity's data.
  // Includes old references (pre-edit) to handle the case where a reference was removed.
  const newReferencedIds = newEntity.private?._reference?.map((x) => x.reference) || []
  const oldReferencedIds = oldEntity.private?._reference?.map((x) => x.reference) || []
  const allReferencedIds = uniqBy([...newReferencedIds, ...oldReferencedIds], (x) => x.toString())

  // Formula Cases 1, 2 & 3: Queue parents, referrers, and referenced entities that have formula properties.
  // Rationale: parents may have _child.* formulas; referrers may have refProp.* formulas;
  // referenced entities may have _referrer.* formulas.
  const formulaCandidateIds = uniqBy([...allParentIds, ...referrerIds, ...allReferencedIds], (x) => x.toString())

  if (formulaCandidateIds.length > 0) {
    const candidatesWithFormulas = await filterEntitiesWithFormulas(entu, formulaCandidateIds)
    ids = [...ids, ...candidatesWithFormulas]
  }

  ids = uniqBy(ids, (x) => x.toString())

  if (ids.length === 0)
    return 0

  await addAggregateQueue(entu, ids)

  return ids.length
}

// Marks entities as queued for background aggregation
export async function addAggregateQueue (entu, entityIds) {
  await entu.db.collection('entity').updateMany({
    _id: { $in: entityIds }
  }, {
    $set: {
      queued: new Date()
    }
  })
}
