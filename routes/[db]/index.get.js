defineRouteMeta({
  openAPI: {
    tags: ['Database'],
    description: 'Database usage and limits: entities, properties, this UTC month\'s API requests and AI tokens, file storage and database size. Cached for 5 minutes.',
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
      }
    ],
    responses: {
      200: {
        description: 'Account statistics',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                organization: {
                  type: 'array',
                  description: 'Organization name values',
                  items: {
                    type: 'object',
                    properties: {
                      language: { type: 'string', description: 'Language code, if any' },
                      string: { type: 'string', description: 'Organization name' }
                    }
                  }
                },
                entities: {
                  type: 'object',
                  properties: {
                    usage: { type: 'integer', description: 'Existing entities (estimate)' },
                    deleted: { type: 'integer', description: 'Entities ever deleted' },
                    limit: { type: 'number', description: '`billing_entities_limit`, 0 if unset' }
                  }
                },
                properties: {
                  type: 'object',
                  properties: {
                    usage: { type: 'integer', description: 'Current property values' },
                    deleted: { type: 'integer', description: 'Deleted property values' }
                  }
                },
                requests: {
                  type: 'object',
                  properties: {
                    usage: { type: 'integer', description: 'API requests this month' },
                    limit: { type: 'integer', description: 'Display scale only: usage rounded up on its leading digit' }
                  }
                },
                tokens: {
                  type: 'object',
                  properties: {
                    usage: { type: 'integer', description: 'AI tokens this month' },
                    limit: { type: 'number', description: '`billing_tokens_limit`, 100000 if unset' }
                  }
                },
                files: {
                  type: 'object',
                  properties: {
                    usage: { type: 'number', description: 'Bytes in live files' },
                    deleted: { type: 'number', description: 'Bytes in deleted files still in storage' },
                    limit: { type: 'number', description: 'Bytes (`billing_data_limit` GB × 10⁹), 0 if unset' }
                  }
                },
                dbSize: { type: 'number', description: 'Data plus index size in bytes' }
              }
            },
            example: {
              organization: [{ language: 'en', string: 'Example Museum' }],
              entities: { usage: 15230, deleted: 412, limit: 50000 },
              properties: { usage: 210554, deleted: 18320 },
              requests: { usage: 1234, limit: 2000 },
              tokens: { usage: 25480, limit: 100000 },
              files: { usage: 5368709120, deleted: 104857600, limit: 10000000000 },
              dbSize: 187695104
            }
          }
        }
      },
      400: {
        description: 'Invalid database name',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      },
      401: {
        description: 'Invalid or expired JWT, or JWT bound to another IP',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      },
      403: {
        description: 'No user in this database',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      },
      404: {
        description: 'Database not found',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      }
    }
  }
})

// Account-level usage stats change slowly, so cache the computed result per
// account to avoid the heavy aggregations on every request. In-memory with a
// short TTL keeps staleness bounded (per server instance).
const STATS_CACHE_TTL = 5 * 60 * 1000
const statsCache = new Map()

export default defineEventHandler(async (event) => {
  const entu = event.context.entu

  if (!entu.user) {
    throw createError({ statusCode: 403, statusMessage: 'No user' })
  }

  const cached = statsCache.get(entu.account)
  if (cached && cached.expires > Date.now()) {
    return cached.data
  }

  const date = new Date().toISOString()

  const [
    stats,
    database,
    entities,
    deletedEntities,
    properties,
    deletedProperties,
    fileUsage,
    requests,
    tokensUsage
  ] = await Promise.all([
    entu.db.stats(),
    entu.db.collection('entity').findOne({ 'private._type.string': 'database', _origin_db: { $exists: false } }, {
      projection: {
        'private.organization.string': true,
        'private.organization.language': true,
        'private.billing_entities_limit.number': true,
        'private.billing_data_limit.number': true,
        'private.billing_requests_limit.number': true,
        'private.billing_tokens_limit.number': true
      }
    }),
    entu.db.collection('entity').estimatedDocumentCount(),
    entu.db.collection('property').aggregate([
      { $match: { type: '_deleted' } },
      { $group: { _id: '$entity' } },
      { $count: 'count' }
    ]).toArray(),
    entu.db.collection('property').countDocuments({ deleted: { $exists: false } }),
    entu.db.collection('property').countDocuments({ deleted: { $exists: true } }),
    // Single pass over all file properties: a file counts as used when it is not
    // deleted and its parent entity still exists, otherwise it is reclaimable
    // (deleted). Projecting only _id in the lookup avoids loading full entity docs.
    entu.db.collection('property').aggregate([
      { $match: { filesize: { $exists: true } } },
      { $lookup: { from: 'entity', localField: 'entity', foreignField: '_id', as: 'entities', pipeline: [{ $project: { _id: 1 } }] } },
      { $group: {
        _id: null,
        usageFilesize: { $sum: { $cond: [{ $and: [{ $eq: [{ $type: '$deleted' }, 'missing'] }, { $gt: [{ $size: '$entities' }, 0] }] }, '$filesize', 0] } },
        deletedFilesize: { $sum: { $cond: [{ $or: [{ $eq: [{ $size: '$entities' }, 0] }, { $ne: [{ $type: '$deleted' }, 'missing'] }] }, '$filesize', 0] } }
      } }
    ]).toArray(),
    entu.db.collection('stats').findOne({ date: date.slice(0, 7), function: 'ALL' }),
    entu.db.collection('stats').findOne({ date: date.slice(0, 7), function: 'AI' })
  ])

  const tokens = (tokensUsage?.promptTokens || 0) + (tokensUsage?.completionTokens || 0)

  const result = {
    organization: (database?.private?.organization || []).map((o) => ({ language: o.language, string: o.string })),
    entities: {
      usage: entities,
      deleted: deletedEntities?.at(0)?.count || 0,
      limit: database?.private?.billing_entities_limit?.at(0)?.number || 0
    },
    properties: {
      usage: properties || 0,
      deleted: deletedProperties || 0
    },
    requests: {
      usage: requests?.count || 0,
      // limit: database?.private?.billing_requests_limit?.at(0)?.number || 0
      limit: Math.ceil(requests?.count / 10 ** (requests?.count.toString().length - 1)) * 10 ** (requests?.count.toString().length - 1) || 0
    },
    tokens: {
      usage: tokens,
      limit: database?.private?.billing_tokens_limit?.at(0)?.number || aiTokensLimitDefault
    },
    files: {
      usage: fileUsage?.at(0)?.usageFilesize || 0,
      deleted: fileUsage?.at(0)?.deletedFilesize || 0,
      limit: (database?.private?.billing_data_limit?.at(0)?.number || 0) * 1e9
    },
    dbSize: stats.dataSize + stats.indexSize
  }

  statsCache.set(entu.account, { expires: Date.now() + STATS_CACHE_TTL, data: result })

  return result
})
