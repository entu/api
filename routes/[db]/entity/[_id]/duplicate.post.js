defineRouteMeta({
  openAPI: {
    tags: ['Entity'],
    description: 'Duplicate entity with all or selected properties. Optionally set a different parent or create multiple copies at once.',
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
          description: 'Entity ID to duplicate'
        }
      }
    ],
    requestBody: {
      required: false,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              count: {
                type: 'number',
                description: 'Number of duplicates to create',
                default: 1,
                minimum: 1,
                maximum: 100
              },
              ignoredProperties: {
                type: 'array',
                items: { type: 'string' },
                description: 'Property types to ignore during duplication (e.g., ["unique_id", "created_at"])'
              }
            }
          }
        }
      }
    },
    responses: {
      200: {
        description: 'Entity duplicated successfully',
        content: {
          'application/json': {
            schema: {
              type: 'array',
              description: 'Array of created entities with their properties',
              items: {
                type: 'object',
                properties: {
                  _id: {
                    type: 'string',
                    description: 'New entity ID',
                    example: '6798938432faaba00f8fc72f'
                  },
                  properties: {
                    type: 'object',
                    description: 'Entity properties indexed by property name',
                    additionalProperties: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          _id: { type: 'string', description: 'Property ID' },
                          string: { type: 'string', description: 'String value' },
                          number: { type: 'number', description: 'Numeric value' },
                          boolean: { type: 'boolean', description: 'Boolean value' },
                          reference: { type: 'string', description: 'Reference to another entity' }
                        }
                      }
                    }
                  }
                },
                required: ['_id', 'properties']
              }
            }
          }
        }
      },
      400: {
        description: 'Invalid count or ignoredProperties',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      },
      403: {
        description: 'No user or not owner',
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
  const { count = 1, ignoredProperties = [] } = await event.req.json()

  if (count < 1 || count > 100) {
    throw createError({ statusCode: 400, statusMessage: 'Count must be between 1 and 100' })
  }

  if (!ignoredProperties.every((x) => typeof x === 'string' && x.length > 0)) {
    throw createError({ statusCode: 400, statusMessage: 'ignoredProperties must be an array of strings' })
  }

  if (!entu.user) {
    throw createError({
      statusCode: 403,
      statusMessage: 'No user'
    })
  }

  const entityId = getObjectId(getRouterParam(event, '_id'))

  // Get the original entity (only _owner for permission check)
  const entity = await entu.db.collection('entity').findOne({
    _id: entityId
  }, {
    projection: {
      'private._owner': true
    }
  })

  if (!entity) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Entity not found'
    })
  }

  const isOwner = entity.private?._owner?.some((owner) => owner.reference?.toString() === entu.userStr)

  if (!isOwner) {
    throw createError({
      statusCode: 403,
      statusMessage: 'User must be owner to duplicate entity'
    })
  }

  // Get all non-deleted properties for this entity (excluding ignored properties and sensitive properties)
  const oldProperties = await entu.db.collection('property').find({
    entity: entityId,
    deleted: { $exists: false },
    filename: { $exists: false },
    type: { $nin: [...ignoredProperties, '_created', '_mid', 'entu_api_key', 'entu_user', 'entu_passkey'] }
  }, {
    projection: {
      _id: false,
      entity: false,
      created: false
    }
  }).toArray()

  // Create the duplicate entities
  const createdEntities = []

  for (let i = 0; i < count; i++) {
    const newEntity = await setEntity(entu, null, [...oldProperties])

    createdEntities.push(newEntity)
  }

  return createdEntities
})
