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
        description: 'Created entity with flattened properties structure',
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
                  type: 'object',
                  description: 'Created properties indexed by property name',
                  additionalProperties: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        _id: { type: 'string', description: 'Property ID' },
                        string: { type: 'string', description: 'String value' },
                        number: { type: 'number', description: 'Numeric value' },
                        boolean: { type: 'boolean', description: 'Boolean value' },
                        reference: { type: 'string', description: 'Reference to another entity' },
                        date: { type: 'string', format: 'date', description: 'Date value' },
                        datetime: { type: 'string', format: 'date-time', description: 'DateTime value' },
                        language: { type: 'string', description: 'Language code for multilingual properties' }
                      }
                    }
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
