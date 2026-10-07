defineRouteMeta({
  openAPI: {
    tags: ['Entity'],
    description: 'Audit log of the entity\'s property changes, oldest first; a same-moment removal and addition is one entry, `_created` and `_mid` are left out. Needs direct or inherited rights; domain or public sharing is not enough.',
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
          description: 'Entries to skip; negative means 0'
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
                  description: 'History entries, oldest first',
                  items: {
                    type: 'object',
                    properties: {
                      type: { type: 'string', description: 'Property name' },
                      at: { type: 'string', format: 'date-time', description: 'Change time, if recorded' },
                      by: { type: 'string', description: 'Author entity ID or `entu` for server changes, if recorded' },
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
                    required: ['type']
                  }
                },
                count: { type: 'integer', description: 'Total entries' }
              },
              required: ['changes', 'count']
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
        description: 'No user, or User not in any rights property',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      },
      404: {
        description: 'Entity {_id} not found, or account not found',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      }
    }
  }
})

export default defineEventHandler(async (event) => {
  const entu = event.context.entu
  const query = getQuery(event)
  const entityId = getObjectId(getRouterParam(event, '_id'))

  await requireDirectAccess(entu, entityId)

  return await entityHistory(entu, entityId, {
    limit: Number.parseInt(query.limit) || 100,
    skip: Number.parseInt(query.skip) || 0
  })
})
