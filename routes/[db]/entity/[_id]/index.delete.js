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

  const entityId = getObjectId(getRouterParam(event, '_id'))

  const entity = await entu.db.collection('entity').findOne({
    _id: entityId
  }, {
    projection: {
      _id: false,
      'private._owner': true
    }
  })

  if (!entity) {
    throw createError({
      statusCode: 404,
      statusMessage: `Entity ${entityId} not found`
    })
  }

  const access = entity.private?._owner?.map((s) => s.reference?.toString()) || []

  if (!access.includes(entu.userStr)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'User not in _owner property'
    })
  }

  await entu.db.collection('property').insertOne({
    entity: entityId,
    type: '_deleted',
    reference: entu.user,
    datetime: new Date(),
    created: {
      at: new Date(),
      by: entu.user
    }
  })

  await aggregateEntity(entu, entityId)

  await triggerWebhooks(entu, entityId, 'entity-delete-webhook')

  const referrers = await entu.db.collection('property').aggregate([
    { $match: { reference: entityId, deleted: { $exists: false } } },
    { $group: { _id: '$entity' } }
  ]).toArray()

  const referrerIds = referrers.map((x) => x._id)

  await entu.db.collection('property').updateMany({
    reference: entityId,
    deleted: { $exists: false }
  }, {
    $set: {
      deleted: {
        at: new Date(),
        by: entu.user
      }
    }
  })

  await addAggregateQueue(entu, referrerIds)

  return { deleted: true }
})
