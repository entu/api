defineRouteMeta({
  openAPI: {
    tags: ['Entity'],
    description: 'Returns the changes this entity (usually a person) has made to other entities, newest first — the first entry is its last activity. Only changes on entities the caller has direct rights on are returned. Writes only: logins and reads are not recorded.',
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
          description: 'ID of the entity whose activity is returned'
        }
      },
      {
        name: 'limit',
        in: 'query',
        schema: {
          type: 'integer',
          default: 100,
          maximum: 1000,
          description: 'Maximum number of activity entries to return'
        }
      },
      {
        name: 'skip',
        in: 'query',
        schema: {
          type: 'integer',
          default: 0,
          description: 'Number of activity entries to skip'
        }
      }
    ],
    responses: {
      200: {
        description: 'Entity activity',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                changes: {
                  type: 'array',
                  description: 'Changes made by this entity, newest first',
                  items: {
                    type: 'object',
                    properties: {
                      entity: {
                        type: 'object',
                        description: 'Entity that was changed',
                        properties: {
                          _id: { type: 'string', description: 'Entity ID' },
                          name: { type: 'string', description: 'Entity name' }
                        }
                      },
                      type: { type: 'string', description: 'Property type that was changed' },
                      at: { type: 'string', format: 'date-time', description: 'When the change occurred' },
                      by: { type: 'string', description: 'ID of the entity that made the change' },
                      old: { type: 'object', description: 'Property value before change' },
                      new: { type: 'object', description: 'Property value after change' }
                    }
                  }
                }
              }
            }
          }
        }
      },
      403: {
        description: 'No user',
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

  return await entityActivity(entu, entityId, {
    limit: Number.parseInt(query.limit) || 100,
    skip: Number.parseInt(query.skip) || 0
  })
})
