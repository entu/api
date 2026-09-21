const IGNORED_TYPES = ['_mid', '_created']
const MAX_LIMIT = 1000
const MAX_SKIP = 10000
const ACTIVITY_MAX_TIME_MS = 10000

// The property value fields a change entry carries as its old or new value
const VALUE_FIELDS = {
  _id: '$_id',
  boolean: '$boolean',
  date: '$date',
  datetime: '$datetime',
  filename: '$filename',
  filesize: '$filesize',
  language: '$language',
  md5: '$md5',
  number: '$number',
  reference: '$reference',
  string: '$string'
}

// Replaces the string of old and new reference values with the referenced entity's name
const REFERENCE_NAME_STAGES = [
  {
    $lookup: {
      from: 'entity',
      let: { ref: '$new.reference' },
      pipeline: [
        { $match: { $expr: { $eq: ['$_id', '$$ref'] } } },
        { $project: { _id: false, name: { $arrayElemAt: ['$private.name.string', 0] } } }
      ],
      as: '_newRef'
    }
  },
  {
    $lookup: {
      from: 'entity',
      let: { ref: '$old.reference' },
      pipeline: [
        { $match: { $expr: { $eq: ['$_id', '$$ref'] } } },
        { $project: { _id: false, name: { $arrayElemAt: ['$private.name.string', 0] } } }
      ],
      as: '_oldRef'
    }
  },
  {
    $addFields: {
      'new.string': {
        $cond: [{ $gt: ['$new.reference', null] }, { $arrayElemAt: ['$_newRef.name', 0] }, '$new.string']
      },
      'old.string': {
        $cond: [{ $gt: ['$old.reference', null] }, { $arrayElemAt: ['$_oldRef.name', 0] }, '$old.string']
      }
    }
  },
  {
    $project: { _id: false, _newRef: false, _oldRef: false }
  }
]

// Throws unless the caller holds direct rights on the entity - history exposes values that may since have been made private, so the domain or public view is not enough.
export async function requireDirectAccess (entu, entityId) {
  if (!entu.userStr) {
    throw createError({ statusCode: 403, statusMessage: 'No user' })
  }

  const entity = await entu.db.collection('entity').findOne({ _id: entityId }, { projection: { _id: false, access: true } })

  if (!entity) {
    throw createError({ statusCode: 404, statusMessage: `Entity ${entityId} not found` })
  }

  if (!entity.access?.map((x) => x.toString()).includes(entu.userStr)) {
    throw createError({ statusCode: 403, statusMessage: 'User not in any rights property' })
  }
}

// Builds an entity's change history for the REST route, the GraphQL _history query and the AI tool. The caller checks access first with requireDirectAccess.
export async function entityHistory (entu, entityId, { limit = 100, skip = 0 } = {}) {
  const changes = await entu.db.collection('property').aggregate([
    {
      $match: {
        entity: entityId,
        type: { $nin: IGNORED_TYPES }
      }
    },
    {
      $project: {
        type: '$type',
        at: '$created.at',
        by: '$created.by',
        new: VALUE_FIELDS
      }
    },
    {
      $unionWith: {
        coll: 'property',
        pipeline: [
          {
            $match: {
              entity: entityId,
              deleted: { $exists: true },
              type: { $nin: IGNORED_TYPES }
            }
          },
          {
            $project: {
              type: '$type',
              at: '$deleted.at',
              by: '$deleted.by',
              old: VALUE_FIELDS
            }
          }
        ]
      }
    },
    {
      $group: {
        _id: { type: '$type', at: '$at', by: '$by' },
        type: { $max: '$type' },
        at: { $max: '$at' },
        by: { $max: '$by' },
        old: { $max: '$old' },
        new: { $max: '$new' }
      }
    },
    ...REFERENCE_NAME_STAGES,
    {
      $sort: { at: 1 }
    },
    {
      $facet: {
        changes: [{ $skip: Math.max(skip, 0) }, { $limit: clampLimit(limit) }],
        count: [{ $count: 'total' }]
      }
    }
  ]).toArray()

  const raw = changes[0]
  const count = raw.count[0]?.total || 0

  return { changes: raw.changes.map(cleanChange), count }
}

// Builds the feed of changes an entity (usually a person) has made, newest first. Only changes on entities the caller holds direct rights on are returned - the rule history applies per entity.
export async function entityActivity (entu, actorId, { limit = 100, skip = 0 } = {}) {
  if (!entu.user) {
    throw createError({ statusCode: 403, statusMessage: 'No user' })
  }

  const actor = await entu.db.collection('entity').findOne({ _id: actorId, access: accessFilter(entu) }, { projection: { _id: true } })

  if (!actor) {
    throw createError({ statusCode: 404, statusMessage: `Entity ${actorId} not found` })
  }

  const safeSkip = clampSkip(skip)
  const safeLimit = clampLimit(limit)

  const changes = await entu.db.collection('property').aggregate([
    ...activityBranch(entu, actorId, 'created', 'new', safeSkip + safeLimit),
    {
      $unionWith: {
        coll: 'property',
        pipeline: activityBranch(entu, actorId, 'deleted', 'old', safeSkip + safeLimit)
      }
    },
    {
      $group: {
        _id: { entity: '$entity._id', type: '$type', at: '$at', by: '$by' },
        entity: { $max: '$entity' },
        type: { $max: '$type' },
        at: { $max: '$at' },
        by: { $max: '$by' },
        old: { $max: '$old' },
        new: { $max: '$new' }
      }
    },
    {
      $sort: { at: -1, 'entity._id': 1, type: 1 }
    },
    {
      $skip: safeSkip
    },
    {
      $limit: safeLimit
    },
    ...REFERENCE_NAME_STAGES
  ], { maxTimeMS: ACTIVITY_MAX_TIME_MS }).toArray()

  return { changes: changes.map(cleanChange) }
}

// Keeps a caller-supplied skip inside 0..MAX_SKIP
function clampSkip (skip) {
  return Math.min(Math.max(skip, 0), MAX_SKIP)
}

// Keeps a caller-supplied limit inside 1..MAX_LIMIT
function clampLimit (limit) {
  return Math.min(Math.max(limit, 1), MAX_LIMIT)
}

// One half of the activity feed - the actor's newest created or deleted properties on entities the caller has direct rights on, streamed off the by/at index and cut early.
function activityBranch (entu, actorId, stamp, side, take) {
  return [
    {
      $match: {
        [`${stamp}.by`]: actorId,
        type: { $nin: IGNORED_TYPES }
      }
    },
    {
      $sort: { [`${stamp}.at`]: -1 }
    },
    {
      $lookup: {
        from: 'entity',
        let: { id: '$entity' },
        pipeline: [
          { $match: { $expr: { $eq: ['$_id', '$$id'] }, access: entu.user } },
          { $project: { name: { $arrayElemAt: ['$private.name.string', 0] } } }
        ],
        as: '_entity'
      }
    },
    {
      $match: { _entity: { $ne: [] } }
    },
    {
      $limit: take
    },
    {
      $project: {
        _id: false,
        entity: { $arrayElemAt: ['$_entity', 0] },
        type: '$type',
        at: `$${stamp}.at`,
        by: `$${stamp}.by`,
        [side]: VALUE_FIELDS
      }
    }
  ]
}

// Masks credential values and drops the empty sides of one change entry
function cleanChange (change) {
  if (change.type === 'entu_api_key' || change.type === 'entu_user') {
    if (change.old?.string) {
      change.old.string = '***'
    }
    if (change.new?.string) {
      change.new.string = '***'
    }
  }
  else if (change.type === 'entu_passkey') {
    if (change.old?.string) {
      change.old.string = `${change.old.passkey_device || ''} ${change.old._id.toString().slice(-4).toUpperCase()}`.trim()
    }
    if (change.new?.string) {
      change.new.string = `${change.new.passkey_device || ''} ${change.new._id.toString().slice(-4).toUpperCase()}`.trim()
    }
  }

  if (change.at === null) {
    delete change.at
  }
  if (change.by === null) {
    delete change.by
  }
  if (change.old === null) {
    delete change.old
  }
  if (change.new === null) {
    delete change.new
  }

  return change
}
