defineRouteMeta({
  openAPI: {
    tags: ['Property'],
    description: 'Soft-delete a property value and trigger `entity-edit-webhook`; a file stays in storage and counts as deleted file storage. See [deleting a property](https://entu.ee/api/properties/#deleting-a-property) for the rights rules.',
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
          description: 'Property ID'
        }
      }
    ],
    responses: {
      200: {
        description: 'Property deleted',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                deleted: {
                  type: 'boolean',
                  description: 'Always true'
                }
              },
              required: ['deleted']
            },
            example: { deleted: true }
          }
        }
      },
      400: {
        description: 'Invalid ID or database name, or `_parent` entity not found',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      },
      401: {
        description: 'Invalid or expired JWT, or JWT bound to another IP',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      },
      403: {
        description: 'No user, undeletable property, missing rights, or last `_owner`',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      },
      404: {
        description: 'Database, property (or already deleted) or entity not found',
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

  if (serverOnlyTypes.includes(property.type)) {
    throw createError({
      statusCode: 403,
      statusMessage: `Can't delete server-managed property ${property.type}`
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

  if (!hasRight(entu, entity, '_editor')) {
    throw createError({
      statusCode: 403,
      statusMessage: 'User not in _owner nor _editor property'
    })
  }

  const isOwner = hasRight(entu, entity, '_owner')

  checkSupportTypes(entu, [property.type], isOwner)

  if (rightTypes.includes(property.type) && !isOwner) {
    throw createError({
      statusCode: 403,
      statusMessage: 'User not in _owner property'
    })
  }

  // Credentials grant login AS the entity - removing one needs its _owner or the entity itself, the same as adding one
  if (isCredentialType(property.type) && !isOwner && property.entity.toString() !== entu.userStr) {
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

    if (!hasRight(entu, parent, '_expander')) {
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
    $set: { deleted: stampFor(entu) }
  })

  await aggregateEntity(entu, property.entity)

  await triggerWebhooks(entu, property.entity, 'entity-edit-webhook')

  return { deleted: true }
})
