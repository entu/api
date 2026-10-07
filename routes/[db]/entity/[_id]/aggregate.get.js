defineRouteMeta({
  openAPI: {
    tags: ['Entity'],
    description: 'Recompute an entity now and queue its dependents; returns a status, not the entity. Any signed-in user, no entity rights needed. See [data flow](https://entu.ee/overview/data-flow/#what-this-means-for-your-application).',
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
      }
    ],
    responses: {
      200: {
        description: 'Aggregation result',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                account: { type: 'string', description: 'Database name' },
                entity: { type: 'string', description: 'Entity ID' },
                queued: { type: 'integer', description: 'Dependents queued; only with `Entity is aggregated`' },
                deleted: { type: 'boolean', description: 'Only with `Entity is deleted` (entity had `_deleted`)' },
                message: { type: 'string', enum: ['Entity is aggregated', 'Entity is deleted', 'Mirror access is updated'], example: 'Entity is aggregated' }
              },
              required: ['account', 'entity', 'message']
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
        description: 'Entity {_id} not found, or account not found',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      }
    }
  }
})

export default defineEventHandler(async (event) => {
  const entu = event.context.entu

  // The local dev server skips the check so the import scripts can re-aggregate without a token.
  if (!entu.user && process.env.NODE_ENV !== 'development') {
    throw createError({ statusCode: 403, statusMessage: 'No user' })
  }

  const entityId = getObjectId(getRouterParam(event, '_id'))

  return await aggregateEntity(entu, entityId)
})
