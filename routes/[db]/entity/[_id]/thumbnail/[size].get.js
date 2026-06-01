const ALLOWED_SIZES = [200, 400, 800]

defineRouteMeta({
  openAPI: {
    tags: ['Entity'],
    description: 'Get a square thumbnail (center cover-crop, JPEG) generated from the first file of the entity\'s `photo` property. Supports image and PDF sources. Thumbnails are cached in S3. Returns a signed download URL (60s) in the `url` field.',
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
        description: 'Invalid size, unsupported file type, or undecodable file',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      },
      403: {
        description: 'Insufficient permissions',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      },
      404: {
        description: 'Entity not found or has no photo',
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

  const entityId = getObjectId(getRouterParam(event, '_id'))

  const entity = await entu.db.collection('entity').findOne({
    _id: entityId
  }, {
    projection: {
      _id: true,
      access: true,
      'public.photo._id': true,
      'domain.photo._id': true,
      'private.photo._id': true
    }
  })

  if (!entity) {
    throw createError({
      statusCode: 404,
      statusMessage: `Entity ${entityId} not found`
    })
  }

  // Resolve the view the caller is allowed to see (mirrors cleanupEntity).
  let photo
  if (entu.userStr && entity.access?.map((x) => x.toString())?.includes(entu.userStr)) {
    photo = entity.private?.photo?.at(0)
  }
  else if (entu.userStr && entity.access?.includes('domain')) {
    photo = entity.domain?.photo?.at(0)
  }
  else if (entity.access?.includes('public')) {
    photo = entity.public?.photo?.at(0)
  }
  else {
    throw createError({
      statusCode: 403,
      statusMessage: 'Insufficient permissions'
    })
  }

  if (!photo) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Entity has no photo'
    })
  }

  return { url: await getThumbnail(entu.account, entity._id, photo, size) }
})
