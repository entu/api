// Ordered mirror visibility levels, most restrictive first
const sharingLevels = ['private', 'domain', 'public']

// Value fields allowed to cross into a mirror, everything else is stripped
const valueFields = ['_id', 'string', 'number', 'boolean', 'reference', 'date', 'datetime', 'language', 'entity_type']

// Maintains a database's incoming mirrors: maps the share config, removes stale mirrors, then syncs per type
export async function syncMirrors (account) {
  const entu = { account, db: await connectDb(account), systemUser: true }
  const shares = await mapShares(entu)

  // A mirror not covered by any mapped origin and type pair is stale — connection or type dropped
  const staleFilter = { _origin_db: { $exists: true } }

  if (shares.length > 0) {
    staleFilter.$nor = shares.map((x) => ({ _origin_db: x.sourceAccount, 'private._type.string': x.typeName }))
  }

  const { deletedCount } = await entu.db.collection('entity').deleteMany(staleFilter)

  if (deletedCount > 0) {
    logger(`Sharing removed ${deletedCount} mirrors`, entu)
  }

  if (shares.length === 0) return

  // What remains is the valid mirror set — one slim query for diffing and parent linkage
  const mirrors = await entu.db.collection('entity').find({ _origin_db: { $exists: true } }, {
    projection: { _origin_db: true, _origin_hash: true, 'private._type': true, 'private.name': true }
  }).toArray()

  const mirrorMap = new Map(mirrors.map((x) => [x._id.toString(), x]))

  for (const share of shares) {
    await syncShare(entu, share, mirrorMap)
  }
}

// Maps all share_in and share_out pairs into flat share items, one per agreed type
async function mapShares (entu) {
  const shareIns = await entu.db.collection('entity').find({
    'private._type.string': 'share_in'
  }, {
    sort: { _id: 1 },
    projection: {
      hash: true,
      'private.database': true,
      'private.type': true,
      'private.property': true,
      'private.parent': true,
      'private.sharing': true,
      'private.inherit': true
    }
  }).toArray()

  // All share_ins naming the same source combine into one connection
  const groups = new Map()

  for (const shareIn of shareIns) {
    const sourceAccount = shareIn.private?.database?.at(0)?.string

    if (typeof sourceAccount !== 'string' || !sourceAccount || sourceAccount === entu.account) continue

    if (!groups.has(sourceAccount)) {
      groups.set(sourceAccount, [])
    }

    groups.get(sourceAccount).push(shareIn)
  }

  const shares = []

  for (const [sourceAccount, group] of groups) {
    let sourceDb

    try {
      sourceDb = await connectDb(formatDatabaseName(sourceAccount))

      if (!sourceDb) {
        throw createError({ statusCode: 404, statusMessage: 'No database' })
      }
    }
    catch (error) {
      // Only a missing or invalid database means inactive — anything else aborts the sweep before removal
      if (![400, 404].includes(error.statusCode)) {
        throw error
      }

      continue
    }

    const shareOuts = await sourceDb.collection('entity').find({
      'private._type.string': 'share_out',
      'private.database.string': entu.account
    }, {
      sort: { _id: 1 },
      projection: {
        hash: true,
        'private.type': true,
        'private.property': true
      }
    }).toArray()

    if (shareOuts.length === 0) continue

    const acceptance = mapAcceptance(group)
    const types = await mapOffers(sourceDb, shareOuts, acceptance)

    // Aggregation already hashes every connection entity, so any config edit changes this
    const configHash = `${shareOuts.map((x) => x.hash || '').join(',')}|${group.map((x) => x.hash || '').join(',')}`

    for (const [typeName, { shareOutIds, propNames }] of types) {
      shares.push({
        sourceAccount,
        sourceDb,
        shareOutIds,
        typeName,
        typeId: acceptance.types.get(typeName),
        properties: [...propNames].map((x) => ({ name: x, id: acceptance.props.get(x) })),
        parents: acceptance.parents,
        sharing: acceptance.sharing,
        inherit: acceptance.inherit,
        configHash
      })
    }
  }

  return shares
}

// Combines a source's share_ins into accepted names with destination ids, parents, sharing and inherit
function mapAcceptance (group) {
  const types = new Map()
  const props = new Map()
  const parents = []
  let sharing
  let inherit = false

  for (const shareIn of group) {
    for (const x of shareIn.private?.type || []) {
      if (typeof x.string === 'string' && x.reference && !types.has(x.string)) {
        types.set(x.string, x.reference)
      }
    }

    for (const x of shareIn.private?.property || []) {
      if (typeof x.string === 'string' && x.reference && !props.has(x.string)) {
        props.set(x.string, x.reference)
      }
    }

    for (const x of shareIn.private?.parent || []) {
      if (x.reference && !parents.some((p) => p.reference.toString() === x.reference.toString())) {
        parents.push({ reference: x.reference, string: x.string })
      }
    }

    const level = shareIn.private?.sharing?.at(0)?.string

    if (sharingLevels.includes(level) && (sharing === undefined || sharingLevels.indexOf(level) > sharingLevels.indexOf(sharing))) {
      sharing = level
    }

    if (shareIn.private?.inherit?.at(0)?.boolean === true) {
      inherit = true
    }
  }

  return { types, props, parents, sharing, inherit }
}

// Resolves a source's share_out references and merges the accepted offers per type
async function mapOffers (sourceDb, shareOuts, acceptance) {
  const types = new Map()
  const refs = shareOuts.flatMap((x) => [
    ...x.private?.type?.filter((v) => v.reference).map((v) => v.reference) || [],
    ...x.private?.property?.filter((v) => v.reference).map((v) => v.reference) || []
  ])

  if (refs.length === 0) {
    return types
  }

  // One query resolves the offered references with their property-to-type pairing
  const defs = await sourceDb.collection('entity').find({
    _id: { $in: refs }
  }, {
    projection: { 'private.name': true, 'private._parent': true }
  }).toArray()

  const defMap = new Map(defs.map((x) => [x._id.toString(), x]))

  for (const shareOut of shareOuts) {
    for (const x of shareOut.private?.type || []) {
      const name = defMap.get(x.reference?.toString())?.private?.name?.at(0)?.string

      if (typeof name !== 'string' || !acceptance.types.has(name)) continue

      if (!types.has(name)) {
        types.set(name, { shareOutIds: [], propNames: new Set() })
      }

      types.get(name).shareOutIds.push(shareOut._id)
    }
  }

  // Second pass, so a property counts even when its type is offered by another share_out
  for (const shareOut of shareOuts) {
    for (const x of shareOut.private?.property || []) {
      const def = defMap.get(x.reference?.toString())
      const propName = def?.private?.name?.at(0)?.string
      const typeName = defMap.get(def?.private?._parent?.at(0)?.reference?.toString())?.private?.name?.at(0)?.string

      if (typeof propName !== 'string' || typeof typeName !== 'string' || !acceptance.props.has(propName)) continue

      if (types.has(typeName)) {
        types.get(typeName).propNames.add(propName)
      }
    }
  }

  return types
}

// Syncs one share item: fetches its granted source entities, removes the revoked, upserts the changed
async function syncShare (entu, share, mirrorMap) {
  // Mirrors are never shared onward, so sharing chains and loops are impossible
  const docs = await share.sourceDb.collection('entity').find({
    access: { $in: share.shareOutIds },
    'private._type.string': share.typeName,
    _origin_db: { $exists: false }
  }, {
    projection: { hash: true, 'private._parent': true }
  }).toArray()

  const sharedIds = new Set(docs.map((x) => x._id.toString()))

  // Mirrors of this origin and type whose grant is gone
  const removeIds = [...mirrorMap.values()]
    .filter((x) => x._origin_db === share.sourceAccount && x.private?._type?.at(0)?.string === share.typeName && !sharedIds.has(x._id.toString()))
    .map((x) => x._id)

  if (removeIds.length > 0) {
    await entu.db.collection('entity').deleteMany({ _id: { $in: removeIds }, _origin_db: share.sourceAccount })
  }

  for (const doc of docs) {
    // Origin parents that are themselves mirrored keep the hierarchy, otherwise share_in parents are used
    const mirroredParents = (doc.private?._parent || [])
      .filter((x) => x.reference && (sharedIds.has(x.reference.toString()) || mirrorMap.get(x.reference.toString())?._origin_db === share.sourceAccount))
      .map((x) => ({ reference: x.reference, string: x.string }))

    const parents = mirroredParents.length > 0 ? mirroredParents : share.parents
    const parentPart = parents.map((x) => x.reference.toString()).sort().join(',')
    const expectedHash = `${doc.hash}|${share.configHash}|${parentPart}`
    const existing = mirrorMap.get(doc._id.toString())

    if (existing?._origin_hash === expectedHash) continue

    try {
      await upsertMirror(entu, share, doc._id, expectedHash, parents, existing)
    }
    catch (error) {
      loggerError(`Sharing mirror failed: ${error.message}`, entu, [`entity:${doc._id}`])
    }
  }
}

// Builds and writes one mirror document from the current source entity
async function upsertMirror (entu, share, entityId, expectedHash, parents, existing) {
  const source = await share.sourceDb.collection('entity').findOne({ _id: entityId }, { projection: { private: true } })

  if (!source) return

  const props = {}

  for (const { name } of share.properties) {
    if (name.startsWith('_') || credentialTypes.includes(name) || serverOnlyTypes.includes(name)) continue

    const values = (Object.hasOwn(source.private, name) ? source.private[name] : [])
      .filter((x) => x.filename === undefined)
      .map((x) => Object.fromEntries(valueFields.filter((f) => x[f] !== undefined).map((f) => [f, x[f]])))

    if (values.length > 0) {
      props[name] = values
    }
  }

  // Only the timestamp crosses — the creator is a source-side identity
  if (source.private._created?.at(0)?.datetime) {
    props._created = [{ datetime: source.private._created.at(0).datetime }]
  }

  props._type = [{ reference: share.typeId, string: share.typeName, entity_type: 'entity' }]

  if (parents.length > 0) {
    props._parent = parents
  }

  // Policy comes from share_in and is stored on the mirror itself, so access derives from the document alone
  if (share.sharing) {
    props._sharing = [{ string: share.sharing }]
  }

  // Makes the rights-change cascade queue this mirror like any inheriting child
  if (share.inherit && parents.length > 0) {
    props._inheritrights = [{ boolean: true }]
  }

  const searchValues = []

  for (const [name, values] of Object.entries(props)) {
    if (name.startsWith('_')) continue

    for (const value of values) {
      if (value.string !== undefined) {
        searchValues.push(value.string)
      }
      if (value.number !== undefined) {
        searchValues.push(value.number)
      }
    }
  }

  const displayProps = { ...props }
  delete displayProps._inheritrights

  const domainVisible = ['domain', 'public'].includes(share.sharing)
  const publicVisible = share.sharing === 'public'
  const mirror = {
    _origin_db: share.sourceAccount,
    _origin_hash: expectedHash,
    aggregated: new Date(),
    private: props
  }

  // Same derivation as the aggregation guard, so access is authoritative from the first write
  const rights = share.inherit && parents.length > 0 ? await getParentRights(entu, parents) : {}
  const access = getAccessArray({ private: { ...rights, _sharing: props._sharing } })

  if (access.length > 0) {
    mirror.access = access
  }

  if (domainVisible) {
    mirror.domain = displayProps
  }

  if (publicVisible) {
    mirror.public = displayProps
  }

  if (searchValues.length > 0) {
    mirror.search = { private: makeSearchArray(searchValues) }

    if (domainVisible) {
      mirror.search.domain = mirror.search.private
    }

    if (publicVisible) {
      mirror.search.public = mirror.search.private
    }
  }

  // Filtering on _origin_db means a clashing local entity raises a duplicate key error instead of being overwritten
  await entu.db.collection('entity').replaceOne({ _id: entityId, _origin_db: share.sourceAccount }, mirror, { upsert: true })

  // A changed name must re-queue local referrers, as they cache the name string
  const oldName = existing?.private?.name?.map((x) => x.string || '').sort().join('|')
  const newName = props.name?.map((x) => x.string || '').sort().join('|')

  if (existing && oldName !== newName) {
    await entu.db.collection('entity').updateMany({ 'private._reference.reference': entityId }, { $set: { queued: new Date() } })
  }
}
