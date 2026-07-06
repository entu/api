defineRouteMeta({
  openAPI: {
    tags: ['Database'],
    description: 'Returns database usage statistics: entity and property counts, monthly API requests, file storage, database size, and account limits.',
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
                entities: {
                  type: 'object',
                  properties: {
                    usage: { type: 'number', description: 'Number of entities used' },
                    deleted: { type: 'number', description: 'Number of deleted entities' },
                    limit: { type: 'number', description: 'Entity limit for account' }
                  }
                },
                properties: {
                  type: 'object',
                  properties: {
                    usage: { type: 'number', description: 'Number of properties used' },
                    deleted: { type: 'number', description: 'Number of deleted properties' }
                  }
                },
                requests: {
                  type: 'object',
                  properties: {
                    usage: { type: 'number', description: 'Number of API requests' },
                    limit: { type: 'number', description: 'Request limit for account' }
                  }
                },
                tokens: {
                  type: 'object',
                  properties: {
                    usage: { type: 'number', description: 'AI tokens used this month (prompt + completion)' },
                    limit: { type: 'number', description: 'AI token limit for account' }
                  }
                },
                files: {
                  type: 'object',
                  properties: {
                    usage: { type: 'number', description: 'File storage used in bytes' },
                    deleted: { type: 'number', description: 'Deleted file storage in bytes' },
                    limit: { type: 'number', description: 'Storage limit in bytes' }
                  }
                },
                dbSize: { type: 'number', description: 'Database size in bytes' }
              }
            }
          }
        }
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

  if (!entu.user) throw createError({ statusCode: 403, statusMessage: 'No user' })

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
    entu.db.collection('entity').findOne({ 'private._type.string': 'database' }, {
      projection: {
        'private.name.string': true,
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
