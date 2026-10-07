defineRouteMeta({
  openAPI: {
    tags: ['Entity'],
    description: 'Property changes made by this entity (usually a person), newest first; writes only, `_created` and `_mid` left out. Only changes on entities the caller has direct or inherited rights to are returned.',
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
          minimum: 1,
          maximum: 1000,
          description: 'Maximum entries; clamped, `0` or non-numeric means 100'
        }
      },
      {
        name: 'skip',
        in: 'query',
        schema: {
          type: 'integer',
          default: 0,
          minimum: 0,
          maximum: 10000,
          description: 'Entries to skip; clamped'
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
                  description: 'Changes, newest first',
                  items: {
                    type: 'object',
                    properties: {
                      entity: {
                        type: 'object',
                        description: 'Changed entity',
                        properties: {
                          _id: { type: 'string', description: 'Entity ID' },
                          name: { type: 'string', description: 'First `name` value, if any' }
                        },
                        required: ['_id']
                      },
                      type: { type: 'string', description: 'Property name' },
                      at: { type: 'string', format: 'date-time', description: 'Change time' },
                      by: { type: 'string', description: 'This entity\'s ID' },
                      old: {
                        type: 'object',
                        description: 'Removed value, if any',
                        properties: {
                          _id: { type: 'string', description: 'Property ID' },
                          string: { type: 'string', description: 'String value, or the referenced entity\'s name; credentials masked' },
                          number: { type: 'number' },
                          boolean: { type: 'boolean' },
                          reference: { type: 'string', description: 'Referenced entity ID' },
                          date: { type: 'string', format: 'date-time' },
                          datetime: { type: 'string', format: 'date-time' },
                          filename: { type: 'string' },
                          filesize: { type: 'integer' },
                          md5: { type: 'string', description: 'File MD5 hash' },
                          language: { type: 'string' }
                        }
                      },
                      new: {
                        type: 'object',
                        description: 'Added value, if any; same fields as `old`'
                      }
                    },
                    required: ['entity', 'type', 'at', 'by']
                  }
                }
              },
              required: ['changes']
            }
          }
        }
      },
      400: {
        description: 'Invalid ID or invalid database name',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      },
      401: {
        description: 'Invalid or expired JWT, or JWT audience does not match caller IP',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      },
      403: {
        description: 'No user',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      },
      404: {
        description: 'Entity not found or not readable, or account not found',
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
