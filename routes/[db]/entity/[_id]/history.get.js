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

  return await entityHistory(entu, entityId, {
    limit: Number.parseInt(query.limit) || 100,
    skip: Number.parseInt(query.skip) || 0
  })
})
