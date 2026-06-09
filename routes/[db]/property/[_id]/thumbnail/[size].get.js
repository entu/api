const ALLOWED_SIZES = [50, 200, 400]

defineRouteMeta({
  openAPI: {
    tags: ['Property'],
    description: 'Get a square thumbnail (center cover-crop, JPEG) generated from a file property. Supports image and PDF sources. Thumbnails are cached in S3. Returns a signed download URL (60s) in the `url` field.',
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
      },
      {
        name: 'size',
        in: 'path',
        required: true,
        schema: {
          type: 'integer',
          enum: ALLOWED_SIZES,
          description: 'Thumbnail size in pixels (width and height of the square)'
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
                url: { type: 'string', description: 'Signed thumbnail download URL (valid 60s)' }
              }
            }
          }
        }
      },
      400: {
        description: 'Invalid size or property is not a previewable file',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      },
      403: {
        description: 'Insufficient permissions',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      },
      404: {
        description: 'Property or entity not found',
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
      [`public.${property.type}._id`]: true
    }
  })

  if (!entity) {
    throw createError({
      statusCode: 404,
      statusMessage: `Entity ${property.entity} not found`
    })
  }

  const publicProperty = entity.public?.[property.type]?.some((x) => x._id.toString() === propertyId.toString())
  const access = entity.access?.map((s) => s.toString()) || []

  if (publicProperty) {
    if (!access.includes('public')) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Not a public property'
      })
    }
  }
  else if (!access.includes(entu.userStr)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'User not in any rights property'
    })
  }

  return { url: await getThumbnail(entu.account, property.entity, property, size) }
})
