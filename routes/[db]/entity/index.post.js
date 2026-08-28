defineRouteMeta({
  openAPI: {
    tags: ['Entity'],
    description: 'Create a new entity. `_type` property is required. Supports all [property types](https://entu.ee/overview/properties). File properties return signed S3 upload URLs.',
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
      }
    ],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'array',
            description: 'Array of property objects to create entity with. Must include a { "type": "_type", "reference": "..." } entry referencing the entity type',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', description: 'Property type', example: 'name' },
                string: { type: 'string', description: 'String value', example: 'My Entity Name' },
                number: { type: 'number', description: 'Number value' },
                boolean: { type: 'boolean', description: 'Boolean value' },
                reference: { type: 'string', description: 'Reference to another entity' },
                date: { type: 'string', format: 'date', description: 'Date value' },
                datetime: { type: 'string', format: 'date-time', description: 'DateTime value' },
                language: { type: 'string', description: 'Language code for multilingual properties' }
              },
              required: ['type']
            }
          }
        }
      }
    },
    responses: {
      200: {
        description: 'Created entity ID and array of created properties',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                _id: {
                  type: 'string',
                  description: 'Created entity ID',
                  example: '6798938432faaba00f8fc72f'
                },
                properties: {
                  type: 'array',
                  description: 'Array of created property objects',
                  items: {
                    type: 'object',
                    properties: {
                      _id: { type: 'string', description: 'Property ID' },
                      type: { type: 'string', description: 'Property type', example: 'name' },
                      string: { type: 'string', description: 'String value. For entu_api_key properties this is the plaintext API key — returned only in this response; only its hash is stored.' },
                      number: { type: 'number', description: 'Numeric value' },
                      boolean: { type: 'boolean', description: 'Boolean value' },
                      reference: { type: 'string', description: 'Reference to another entity' },
                      date: { type: 'string', format: 'date', description: 'Date value' },
                      datetime: { type: 'string', format: 'date-time', description: 'DateTime value' },
                      language: { type: 'string', description: 'Language code for multilingual properties' },
                      filename: { type: 'string', description: 'File name (file properties)' },
                      filesize: { type: 'number', description: 'File size in bytes (file properties)' },
                      filetype: { type: 'string', description: 'File MIME type (file properties)' },
                      invite: { type: 'string', description: 'Invite JWT, returned only for entu_user properties. Valid for 24 hours.' },
                      upload: {
                        type: 'object',
                        description: 'Signed S3 upload instructions, returned only for file properties',
                        properties: {
                          url: { type: 'string', description: 'Signed S3 upload URL' },
                          method: { type: 'string', description: 'HTTP method to use for upload', example: 'PUT' },
                          headers: {
                            type: 'object',
                            description: 'Headers that must be sent with the upload request',
                            additionalProperties: { type: 'string' }
                          }
                        }
                      }
                    },
                    required: ['_id', 'type']
                  }
                }
              }
            }
          }
        }
      },
      400: {
        description: 'Bad Request - Invalid property data',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/Error'
            }
          }
        }
      },
      403: {
        description: 'No user',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      }
    }
  }
})

export default defineEventHandler(async (event) => {
  const entu = event.context.entu
  const body = await event.req.json()

  if (!entu.user) {
    throw createError({
      statusCode: 403,
      statusMessage: 'No user'
    })
  }

  const { _id, properties } = await setEntity(entu, undefined, body)

  await triggerWebhooks(entu, _id, 'entity-add-webhook')

  return { _id, properties }
})
