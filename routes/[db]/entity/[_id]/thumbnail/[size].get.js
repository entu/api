const ALLOWED_SIZES = [50, 200, 400]

defineRouteMeta({
  openAPI: {
    tags: ['Entity'],
    description: 'Get a signed URL to a square JPEG thumbnail of the entity\'s first `photo` in the caller\'s view. See [entity thumbnail](https://entu.ee/api/files/#entity-thumbnail).',
    security: [{}, { bearerAuth: [] }], // The token is optional; without it only public entities are readable
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
        description: 'Invalid size or ID, not a previewable file, image too large, undecodable file, or invalid database name',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      },
      401: {
        description: 'Invalid or expired JWT, or JWT audience does not match caller IP',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      },
      403: {
        description: 'Insufficient permissions',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      },
      404: {
        description: 'Entity not found, no photo in the caller\'s view, file missing from storage, or account not found',
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

  const entityId = getObjectId(getRouterParam(event, '_id'))

  const entity = await entu.db.collection('entity').findOne({
    _id: entityId
  }, {
    projection: {
      _id: true,
      access: true,
      'public.photo._id': true,
      'public.photo.filename': true,
      'public.photo.filetype': true,
      'domain.photo._id': true,
      'domain.photo.filename': true,
      'domain.photo.filetype': true,
      'private.photo._id': true,
      'private.photo.filename': true,
      'private.photo.filetype': true
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
