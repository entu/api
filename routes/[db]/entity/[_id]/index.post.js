defineRouteMeta({
  openAPI: {
    tags: ['Entity'],
    description: 'Add property values to an entity, or replace one by sending its `_id` ([overwriting](https://entu.ee/api/properties/#overwriting-a-property-value)). Needs `_editor`; rights properties and credentials need `_owner` (credentials also the entity itself), and setting a user\'s right removes their other rights. `entu_user` = `send-invite` emails an invite. See [files](https://entu.ee/api/files/#upload-process) and [webhooks](https://entu.ee/configuration/plugins/#plugin-types).',
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
      }
    ],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'array',
            description: 'Property values. Rights, `_type` and `_parent` take `reference`, `_sharing` a `string`, `_inheritrights` a `boolean`; other `_` names and billing values are rejected, `entu_user` and `entu_api_key` take only `string` and `email`.',
            minItems: 1,
            items: {
              type: 'object',
              properties: {
                _id: { type: 'string', description: 'Existing value of this entity to replace; the rights to remove its own `type` are checked too' },
                type: { type: 'string', pattern: '^\\w+$', description: 'Property name (letters, digits and underscore)', example: 'name' },
                string: { type: 'string', description: 'String or text value; for `entu_user` creates an invite (`send-invite` also emails it), for `entu_api_key` a key is generated', example: 'Updated Name' },
                number: { type: 'number', description: 'Number value', example: 100 },
                boolean: { type: 'boolean', description: 'Boolean value', example: false },
                reference: { type: 'string', description: 'Referenced entity ID' },
                date: { type: 'string', format: 'date', description: 'Date value', example: '2025-01-28' },
                datetime: { type: 'string', format: 'date-time', description: 'Datetime value', example: '2025-01-28T08:21:25.637Z' },
                language: { type: 'string', pattern: '^[a-z]{2}$', description: 'Language code', example: 'en' },
                filename: { type: 'string', description: 'File name; files need `filename`, `filesize` and `filetype`' },
                filesize: { type: 'integer', description: 'File size in bytes' },
                filetype: { type: 'string', description: 'File MIME type', example: 'image/jpeg' },
                counter: { type: ['boolean', 'number'], description: 'Next counter value: the database\'s highest `number` for this property plus the given step (`true` = 1); a sent `string` keeps its own last number' },
                email: { type: 'string', description: 'Email for an `entu_user` value' }
              },
              required: ['type']
            }
          }
        }
      }
    },
    responses: {
      200: {
        description: 'Entity ID and all written values',
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
                  description: 'Written values with `type`, without `created`; a replaced value gets a new `_id`',
                  items: {
                    type: 'object',
                    properties: {
                      _id: { type: 'string', description: 'Property ID' },
                      type: { type: 'string', description: 'Property name', example: 'name' },
                      string: { type: 'string', description: 'String value; for `entu_api_key` the plaintext key, returned only here' },
                      number: { type: 'number', description: 'Numeric value' },
                      boolean: { type: 'boolean', description: 'Boolean value' },
                      reference: { type: 'string', description: 'Referenced entity ID' },
                      date: { type: 'string', format: 'date-time', description: 'Date at UTC midnight', example: '2025-01-28T00:00:00.000Z' },
                      datetime: { type: 'string', format: 'date-time', description: 'Datetime value' },
                      language: { type: 'string', description: 'Language code' },
                      filename: { type: 'string', description: 'File name' },
                      filesize: { type: 'integer', description: 'File size in bytes' },
                      filetype: { type: 'string', description: 'File MIME type' },
                      email: { type: 'string', description: 'Email of an `entu_user` value (the entity\'s `email` for `send-invite`)' },
                      invite: { type: 'string', description: 'Invite JWT replacing an `entu_user` `string`, valid 24 hours' },
                      upload: {
                        type: 'object',
                        description: 'Signed S3 upload for file values. See [upload process](https://entu.ee/api/files/#upload-process).',
                        properties: {
                          url: { type: 'string', description: 'Signed upload URL, valid 60 seconds' },
                          method: { type: 'string', description: 'HTTP method', example: 'PUT' },
                          headers: {
                            type: 'object',
                            description: 'Required upload headers',
                            properties: {
                              ACL: { type: 'string', example: 'private' },
                              'Content-Disposition': { type: 'string', example: 'inline;filename="photo.jpg"' },
                              'Content-Length': { type: 'integer', description: 'The sent `filesize`' },
                              'Content-Type': { type: 'string', description: 'The sent `filetype`', example: 'image/jpeg' }
                            }
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
        description: 'Invalid body, empty value, `_id` not a live value of this entity, `send-invite` without `email`, `_parent` not found, no `_expander` on parent, invalid ID or database name',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      },
      401: {
        description: 'Invalid or expired JWT, or JWT audience does not match caller IP',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      },
      403: {
        description: 'No user, missing `_editor`/`_owner` rights, or a server-only property or field sent',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      },
      404: {
        description: 'Entity {_id} not found, or account not found',
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

  return { _id, properties: properties.map((p) => credentialWritten(entu, _id, p)) }
})
