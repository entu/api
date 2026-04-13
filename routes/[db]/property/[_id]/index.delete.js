defineRouteMeta({
  openAPI: {
    tags: ['Property'],
    description: 'Soft-delete a property. Entity is re-aggregated automatically. Files are removed from S3. Requires editor rights; rights properties require owner rights. `_type` cannot be deleted.',
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
          description: 'Property ID to delete'
        }
      }
    ],
    responses: {
      200: {
        description: 'Property deleted successfully',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                deleted: {
                  type: 'boolean',
                  example: true,
                  description: 'Confirmation that property was deleted'
                }
              }
            }
          }
        }
      },
      403: {
        description: 'No user, insufficient rights, or cannot delete `_type` / last `_owner`',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      },
      404: {
        description: 'Property not found',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      }
    }
  }
})

const rightTypes = [
  '_noaccess',
  '_viewer',
  '_expander',
  '_editor',
  '_owner',
  '_sharing',
  '_parent',
  '_inheritrights'
]

export default defineEventHandler(async (event) => {
  const entu = event.context.entu

  if (!entu.user) {
    throw createError({
      statusCode: 403,
      statusMessage: 'No user'
    })
  }

  const propertyId = getObjectId(getRouterParam(event, '_id'))

  const property = await entu.db.collection('property').findOne({
    _id: propertyId,
    deleted: { $exists: false }
  }, {
    projection: {
      _id: false,
      entity: true,
      type: true,
      reference: true
    }
  })

  if (!property) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Property not found'
    })
  }

  if (property.type === '_type') {
    throw createError({
      statusCode: 403,
      statusMessage: 'Can\'t delete _type property'
    })
  }

  if (property.type.startsWith('_') && !rightTypes.includes(property.type)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Can\'t delete system property'
    })
  }

  const entity = await entu.db.collection('entity').findOne({
    _id: property.entity
  }, {
    projection: {
      _id: false,
      'private._editor': true,
      'private._owner': true
    }
  })

  if (!entity) {
    throw createError({
      statusCode: 404,
      statusMessage: `Entity ${property.entity} not found`
    })
  }

  const access = entity.private?._editor?.map((s) => s.reference?.toString()) || []

  if (!access.includes(entu.userStr)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'User not in _owner nor _editor property'
    })
  }

  const owners = entity.private?._owner?.map((s) => s.reference?.toString()) || []

  if (rightTypes.includes(property.type) && !owners.includes(entu.userStr)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'User not in _owner property'
    })
  }

  if (property.type === '_owner' && (entity.private?._owner?.length || 0) <= 1) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Can\'t delete last _owner'
    })
  }

  if (property.type === '_parent' && property.reference) {
    const parent = await entu.db.collection('entity').findOne({
      _id: property.reference
    }, {
      projection: {
        _id: false,
        'private._expander': true
      }
    })

    if (!parent) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Entity in _parent property not found'
      })
    }

    const parentAccess = parent.private?._expander?.map((s) => s.reference?.toString()) || []

    if (!parentAccess.includes(entu.userStr) && !entu.systemUser) {
      throw createError({
        statusCode: 403,
        statusMessage: 'User not in parent _owner, _editor nor _expander property'
      })
    }
  }

  await entu.db.collection('property').updateOne({
    _id: propertyId,
    entity: property.entity
  }, {
    $set: {
      deleted: {
        at: new Date(),
        by: entu.user
      }
    }
  })

  await aggregateEntity(entu, property.entity)

  await triggerWebhooks(entu, property.entity, 'entity-edit-webhook')

  return { deleted: true }
})
