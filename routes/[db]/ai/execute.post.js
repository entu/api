defineRouteMeta({
  openAPI: {
    tags: ['AI'],
    description: 'Execute AI-proposed operations after user confirmation. Operations are re-validated and executed sequentially as the calling user; execution stops at the first failure and already applied operations are reported.',
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
            type: 'object',
            properties: {
              operations: {
                type: 'array',
                description: 'Operations from the chat endpoint proposal — 1 to 25 items, executed in order',
                items: {
                  type: 'object',
                  properties: {
                    op: {
                      type: 'string',
                      enum: ['create_entity_type', 'add_property_definition', 'create_entity', 'update_entity', 'delete_property'],
                      description: 'Operation type'
                    },
                    params: { type: 'object', description: 'Operation parameters' }
                  },
                  required: ['op', 'params']
                }
              }
            },
            required: ['operations']
          }
        }
      }
    },
    responses: {
      200: {
        description: 'Execution result — partial when an operation fails',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                results: {
                  type: 'array',
                  description: 'Successfully executed operations in order',
                  items: {
                    type: 'object',
                    properties: {
                      tempId: { type: 'string', description: 'Temporary id ("$1", "$2", ...) of the operation' },
                      _id: { type: 'string', description: 'Affected entity id (absent for delete_property)' },
                      op: { type: 'string', description: 'Operation type' }
                    }
                  }
                },
                error: {
                  type: 'object',
                  description: 'Present when execution stopped at a failing operation',
                  properties: {
                    index: { type: 'integer', description: 'Index of the failed operation' },
                    statusCode: { type: 'integer', description: 'Error status code' },
                    statusMessage: { type: 'string', description: 'Error message' }
                  }
                }
              }
            }
          }
        }
      },
      400: {
        description: 'Invalid operations',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
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

  if (!entu.user) {
    throw createError({
      statusCode: 403,
      statusMessage: 'No user'
    })
  }

  const body = await event.req.json()

  aiValidateOperations(body?.operations)

  return await aiExecuteOperations(entu, body.operations)
})
