defineRouteMeta({
  openAPI: {
    tags: ['Entity'],
    description: 'Re-aggregate entity — recomputes [formulas](https://entu.ee/api/formulas), inherited rights, and search indexes. Returns fresh entity data. Regular GET returns cached data — use this only when you need up-to-date computed values.',
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
                queued: { type: 'integer', description: 'Number of related entities queued for re-aggregation' },
                message: { type: 'string', example: 'Entity is aggregated' }
              }
            }
          }
        }
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

  const entityId = getObjectId(getRouterParam(event, '_id'))

  return await aggregateEntity(entu, entityId)
})
