defineRouteMeta({
  openAPI: {
    tags: ['Entity'],
    description: 'Add properties to an entity. Does not remove existing properties. File properties return signed S3 upload URLs. Requires editor rights.',
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
          description: 'Entity ID to update'
        }
      }
    ],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'array',
            description: 'Array of property objects to add or update',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', description: 'Property type', example: 'name' },
                string: { type: 'string', description: 'String value', example: 'Updated Name' },
                number: { type: 'number', description: 'Number value', example: 100 },
                boolean: { type: 'boolean', description: 'Boolean value', example: false },
                reference: { type: 'string', description: 'Reference to another entity' },
                date: { type: 'string', format: 'date', description: 'Date value', example: '2025-01-28' },
                datetime: { type: 'string', format: 'date-time', description: 'DateTime value', example: '2025-01-28T08:21:25.637Z' },
                language: { type: 'string', description: 'Language code for multilingual properties', example: 'en' }
              },
              required: ['type']
            }
          }
        }
      }
    },
    responses: {
      200: {
        description: 'Entity ID and array of added properties',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                _id: {
                  type: 'string',
                  description: 'Entity ID',
                  example: '6798938432faaba00f8fc72f'
                },
                properties: {
                  type: 'array',
                  description: 'Array of added property objects',
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
        description: 'Invalid input — body must be an array of property objects',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      },
      403: {
        description: 'No user or insufficient permissions',
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
  const body = await event.req.json()

  if (!entu.user) {
    throw createError({
      statusCode: 403,
      statusMessage: 'No user'
    })
  }

  if (!Array.isArray(body)) {
    throw createError({ statusCode: 400, statusMessage: 'Data must be array' })
  }

  const entityId = getObjectId(getRouterParam(event, '_id'))

  const isSendInvite = body.some((p) => p.type === 'entu_user' && p.string === 'send-invite')

  let email
  if (isSendInvite) {
    const entity = await entu.db.collection('entity').findOne({ _id: entityId }, { projection: { 'private.email': true } })
    email = entity?.private?.email?.at(0)?.string

    if (!email) {
      throw createError({ statusCode: 400, statusMessage: 'No email' })
    }
  }

  const bodyWithEmail = isSendInvite
    ? body.map((p) => p.type === 'entu_user' && p.string === 'send-invite' ? { ...p, email } : p)
    : body

  const { _id, properties } = await setEntity(entu, entityId, bodyWithEmail)

  if (isSendInvite) {
    const { appUrl } = useRuntimeConfig()

    const inviteToken = properties.find((p) => p.type === 'entu_user')?.invite
    const inviterEntity = entu.user ? await entu.db.collection('entity').findOne({ _id: entu.user }, { projection: { 'private.name.string': true } }) : null
    const inviterName = inviterEntity?.private?.name?.at(0)?.string || entu.email

    await sendInviteEmail({ to: email, inviteUrl: `${appUrl}/${entu.account}/invite?token=${inviteToken}`, account: entu.account, inviterName })
  }

  await triggerWebhooks(entu, _id, 'entity-edit-webhook')

  return { _id, properties }
})
