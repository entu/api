defineRouteMeta({
  openAPI: {
    tags: ['Entity'],
    description: 'Returns chronological audit log of all property changes — additions, modifications, and deletions with timestamps and authors.',
    security: [{ bearerAuth: [] }],
    parameters: [
      {
        name: 'db',
        in: 'path',
        required: true,
        schema: {
          type: 'string',
          description: 'Database name'
        }
      },
      {
        name: '_id',
        in: 'path',
        required: true,
        schema: {
          type: 'string',
          description: 'Entity ID'
        }
      },
      {
        name: 'limit',
        in: 'query',
        schema: {
          type: 'integer',
          default: 100,
          description: 'Maximum number of history entries to return'
        }
      },
      {
        name: 'skip',
        in: 'query',
        schema: {
          type: 'integer',
          default: 0,
          description: 'Number of history entries to skip'
        }
      }
    ],
    responses: {
      200: {
        description: 'Entity change history',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                changes: {
                  type: 'array',
                  description: 'Array of history entries showing entity changes',
                  items: {
                    type: 'object',
                    properties: {
                      type: { type: 'string', description: 'Property type that was changed' },
                      at: { type: 'string', format: 'date-time', description: 'When the change occurred' },
                      by: { type: 'string', description: 'User ID who made the change' },
                      old: { type: 'object', description: 'Property value before change' },
                      new: { type: 'object', description: 'Property value after change' }
                    }
                  }
                },
                count: { type: 'integer', description: 'Total number of history entries' }
              }
            }
          }
        }
      },
      403: {
        description: 'Insufficient permissions',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      },
      404: {
        description: 'Entity not found',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      }
    }
  }
})

export default defineEventHandler(async (event) => {
  const entu = event.context.entu
  const query = getQuery(event)
  const limit = Number.parseInt(query.limit) || 100
  const skip = Number.parseInt(query.skip) || 0

  const entityId = getObjectId(getRouterParam(event, '_id'))
  const entity = await entu.db.collection('entity').findOne({
    _id: entityId
  }, {
    projection: {
      _id: false,
      access: true
    }
  })

  if (!entity) {
    throw createError({
      statusCode: 404,
      statusMessage: `Entity ${entityId} not found`
    })
  }

  const access = entity.access?.map((s) => s.toString()) || []

  if (!access.includes(entu.userStr)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'User not in any rights property'
    })
  }

  const changes = await entu.db.collection('property').aggregate([
    {
      $match: {
        entity: entityId,
        type: { $nin: ['_mid', '_created'] }
      }
    },
    {
      $project: {
        type: '$type',
        at: '$created.at',
        by: '$created.by',
        new: {
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
              type: {
                $nin: ['_mid', '_created']
              }
            }
          },
          {
            $project: {
              type: '$type',
              at: '$deleted.at',
              by: '$deleted.by',
              old: {
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
    },
    {
      $sort: { at: 1 }
    },
    {
      $facet: {
        changes: [{ $skip: skip }, { $limit: limit }],
        count: [{ $count: 'total' }]
      }
    }
  ]).toArray()

  const raw = changes[0]
  const count = raw.count[0]?.total || 0

  const cleanChanges = raw.changes.map((x) => {
    if (x.type === 'entu_api_key') {
      if (x.old.string)
        x.old.string = '***'
      if (x.new.string)
        x.new.string = '***'
    }

    if (x.type === 'entu_passkey') {
      if (x.old?.string)
        x.old.string = `${x.old.passkey_device || ''} ${x.old._id.toString().slice(-4).toUpperCase()}`.trim()
      if (x.new?.string)
        x.new.string = `${x.new.passkey_device || ''} ${x.new._id.toString().slice(-4).toUpperCase()}`.trim()
    }

    if (x.at === null)
      delete x.at
    if (x.by === null)
      delete x.by
    if (x.old === null)
      delete x.old
    if (x.new === null)
      delete x.new

    return x
  })

  return { changes: cleanChanges, count }
})
