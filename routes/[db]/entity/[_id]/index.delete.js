defineRouteMeta({
  openAPI: {
    tags: ['Entity'],
    description: 'Delete an entity; needs `_owner`. References to it (including children\'s `_parent`) are soft-deleted, children are kept; `entity-delete-webhook` plugins are currently not called. See [deletion](https://entu.ee/overview/entities/#deletion).',
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
        description: 'Entity successfully deleted',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                deleted: {
                  type: 'boolean',
                  description: 'Deletion confirmation',
                  example: true
                }
              },
              required: ['deleted']
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
        description: 'No user, or User not in _owner property',
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

  if (!entu.user) {
    throw createError({
      statusCode: 403,
      statusMessage: 'No user'
    })
  }

  await deleteEntity(entu, getObjectId(getRouterParam(event, '_id')))

  return { deleted: true }
})
