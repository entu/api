defineRouteMeta({
  openAPI: {
    tags: ['Property'],
    description: 'Get one property value as stored, with `entity` and `created`, if the caller has entity rights or the value is in its domain or public view. References carry no name, `entu_api_key` is masked, `entu_passkey` gets a device label. See [properties](https://entu.ee/api/properties/) and [file download](https://entu.ee/api/files/#download-process).',
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
                    passkey_device: {
                      type: 'string',
                      description: 'Passkey device name'
                    },
                    passkey_id: {
                      type: 'string',
                      description: 'WebAuthn credential ID'
                    },
                    passkey_public: {
                      type: 'string',
                      description: 'Base64url public key'
                    },
                    passkey_counter: {
                      type: 'integer',
                      description: 'Last signature counter'
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

  if (property.type === 'entu_api_key') {
    property.string = '***'
  }
  else if (property.type === 'entu_passkey') {
    property.string = `${property.passkey_device || ''} ${property._id.toString().slice(-4).toUpperCase()}`.trim()
  }

  if (property.url && getQuery(event).download) {
    return redirect(property.url, 302)
  }
  else {
    return property
  }
})
