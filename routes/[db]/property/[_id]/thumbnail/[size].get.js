const ALLOWED_SIZES = [50, 200, 400]

defineRouteMeta({
  openAPI: {
    tags: ['Property'],
    description: 'Get a signed URL to a square JPEG thumbnail of a file property; access as for `GET /{db}/property/{_id}`. See [property thumbnail](https://entu.ee/api/files/#property-thumbnail).',
    security: [{}, { bearerAuth: [] }],
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
      },
      {
        name: 'size',
        in: 'path',
        required: true,
        schema: {
          type: 'integer',
          enum: [50, 200, 400],
          description: 'Square side in pixels'
        }
      }
    ],
    responses: {
      200: {
        description: 'Signed thumbnail download URL',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                url: { type: 'string', description: 'Signed URL, valid 60 seconds' }
              },
              required: ['url']
            }
          }
        }
      },
      400: {
        description: 'Invalid size, ID or database name, not an image or PDF, image too large, or undecodable file',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      },
      401: {
        description: 'Invalid or expired JWT, or JWT bound to another IP',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      },
      403: {
        description: 'No access to property',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      },
      404: {
        description: 'Database, property or entity not found, or file missing from storage',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      },
      413: {
        description: 'Source file over 25 MB',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      }
    }
  }
})

export default defineEventHandler(async (event) => {
  const entu = event.context.entu

  const size = Number.parseInt(getRouterParam(event, 'size'), 10)

  if (!ALLOWED_SIZES.includes(size)) {
    throw createError({
      statusCode: 400,
      statusMessage: `Invalid size. Allowed sizes: ${ALLOWED_SIZES.join(', ')}`
    })
  }

  const propertyId = getObjectId(getRouterParam(event, '_id'))

  const property = await entu.db.collection('property').findOne({
    _id: propertyId,
    deleted: { $exists: false }
  })

  if (!property) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Property not found'
    })
  }

  const entity = await entu.db.collection('entity').findOne({
    _id: property.entity
  }, {
    projection: {
      _id: false,
      access: true,
      [`domain.${property.type}._id`]: true,
      [`public.${property.type}._id`]: true
    }
  })

  if (!entity) {
    throw createError({
      statusCode: 404,
      statusMessage: `Entity ${property.entity} not found`
    })
  }

  if (!canReadProperty(entu, entity, property)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'No access to property'
    })
  }

  return { url: await getThumbnail(entu.account, property.entity, property, size) }
})
