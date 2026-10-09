defineRouteMeta({
  openAPI: {
    tags: ['Property'],
    description: 'Get one property value as stored, with `entity` and `created`, if the caller has entity rights or the value is in its domain or public view. References carry no name; credentials return only their masked form (`entu_user`: email or passkey label, provider and an invite flag; `entu_api_key`: `***`). See [properties](https://entu.ee/api/properties/) and [file download](https://entu.ee/api/files/#download-process).',
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
        name: 'download',
        in: 'query',
        schema: {
          type: 'string',
          description: 'Any non-empty value redirects to the file'
        }
      }
    ],
    responses: {
      200: {
        description: 'Property value',
        content: {
          'application/json': {
            schema: {
              allOf: [
                { $ref: '#/components/schemas/Property' },
                {
                  type: 'object',
                  properties: {
                    url: {
                      type: 'string',
                      description: 'Signed download URL, valid 60 seconds; files only'
                    },
                    provider: {
                      type: 'string',
                      description: '`entu_user`: login provider'
                    },
                    invite: {
                      type: 'boolean',
                      description: '`entu_user`: `true` while an invite is pending'
                    }
                  }
                }
              ]
            },
            example: {
              _id: '6798938532faaba00f8fc761',
              entity: '6798938532faaba00f8fc75f',
              type: 'photo',
              filename: 'label.jpg',
              filesize: 48213,
              filetype: 'image/jpeg',
              created: {
                at: '2025-01-28T08:21:25.637Z',
                by: '506e7c33dcb4b5c4fde735d0'
              },
              url: 'https://files.example.com/account/6798938532faaba00f8fc75f/6798938532faaba00f8fc761?X-Amz-Expires=60'
            }
          }
        }
      },
      302: {
        description: 'Redirect to the signed file URL (`download` set)'
      },
      400: {
        description: 'Invalid property ID or database name',
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
        description: 'Database, property (or deleted) or entity not found',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      }
    }
  }
})

export default defineEventHandler(async (event) => {
  const entu = event.context.entu

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

  if (property.filename) {
    property.url = await getSignedDownloadUrl(entu.account, property.entity, property)
  }

  if (property.url && getQuery(event).download) {
    return redirect(property.url, 302)
  }

  if (!credentialTypes.includes(property.type) && !retiredCredentialTypes.includes(property.type)) {
    return property
  }

  // A credential shows only its masked form, the same as in entity responses
  return { type: property.type, entity: property.entity, created: property.created, ...credentialMask(property.type, property) }
})
