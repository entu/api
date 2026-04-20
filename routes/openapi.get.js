defineRouteMeta({ openAPI: { hidden: true } })

export default defineEventHandler(async () => {
  // Get the original OpenAPI spec from the default route
  const openapi = await $fetch('/_openapi.json')

  // Keep only documented paths (exclude hidden and internal routes)
  if (openapi.paths) {
    openapi.paths = Object.fromEntries(
      Object.entries(openapi.paths).filter(([path, methods]) =>
        !path.startsWith('/docs')
        && !path.startsWith('/graphql')
        && !path.startsWith('/_')
        && !Object.values(methods).some((op) => op?.hidden)
      )
    )
  }

  // Add additional OpenAPI metadata that Nitro config doesn't support
  openapi.servers = [
    {
      url: 'https://api.entu.app'
    }
  ]

  openapi.info.description = 'RESTful API for [Entu](https://entu.ee) — a flexible entity-property database. Entities hold typed properties (text, numbers, dates, files, references) defined per entity type, with no fixed schema. Supports hierarchical structures, granular access control, full-text search, filtering, sorting, computed properties ([formulas](https://entu.ee/api/formulas)), and file management via signed URLs.\n\nAuthentication uses JWT tokens obtained via API key, OAuth, or WebAuthn passkey. See [authentication docs](https://entu.ee/api/authentication) for details.'

  if (!openapi.components) {
    openapi.components = {}
  }

  // Remove all existing security schemes first
  if (openapi.components.securitySchemes) {
    delete openapi.components.securitySchemes
  }

  // Define only Bearer Auth as the available authentication method
  openapi.components.securitySchemes = {
    bearerAuth: {
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description: 'JWT token obtained from /auth endpoint'
    }
  }

  // Set global security to only show Bearer Auth option
  openapi.security = [{ bearerAuth: [] }]

  openapi.tags = [
    {
      name: 'Authentication',
      description: 'Exchange API key, OAuth token, or passkey for a 48-hour JWT. Use `Authorization: Bearer <token>` on all subsequent requests. See [authentication docs](https://entu.ee/api/authentication).'
    },
    {
      name: 'Database',
      description: 'Database statistics, limits, and billing management.'
    },
    {
      name: 'Entity',
      description: 'CRUD operations on [entities](https://entu.ee/overview/entities) — filtering, sorting, pagination, full-text search, change history, duplication, and aggregation of [computed properties](https://entu.ee/api/formulas).'
    },
    {
      name: 'Property',
      description: 'Read or delete individual [property](https://entu.ee/overview/properties) values. File properties return signed download URLs.'
    }
  ]

  // Models - Core data structures for the Entu API
  if (!openapi.components.schemas) {
    openapi.components.schemas = {}
  }

  // Entity - Core entity model with flattened properties structure
  openapi.components.schemas.Entity = {
    type: 'object',
    description: 'Entity with flattened properties.',
    properties: {
      _id: {
        type: 'string',
        description: 'Entity ID',
        example: '6798938432faaba00f8fc72f'
      },
      _type: {
        type: 'string',
        description: 'Entity type reference',
        example: '6798938432faaba00f8fc72e'
      },
      _owner: {
        type: 'array',
        description: 'Owners',
        items: {
          $ref: '#/components/schemas/Property'
        }
      },
      _created: {
        type: 'array',
        description: 'Creation metadata',
        items: {
          $ref: '#/components/schemas/Property'
        }
      },
      _sharing: {
        type: 'array',
        description: 'Sharing level',
        items: {
          $ref: '#/components/schemas/Property'
        }
      },
      _thumbnail: {
        type: 'string',
        description: 'Thumbnail URL',
        format: 'uri',
        example: 'https://api.entu.app/entity/thumbnail/6798938432faaba00f8fc72f'
      }
    },
    additionalProperties: {
      type: 'array',
      description: 'Dynamic properties defined by the entity type',
      items: {
        $ref: '#/components/schemas/Property'
      }
    },
    required: ['_id', '_type']
  }

  // Property - Individual property with typed values and metadata
  openapi.components.schemas.Property = {
    type: 'object',
    description: 'Typed property value with metadata.',
    properties: {
      _id: {
        type: 'string',
        description: 'Property ID',
        example: '6798938532faaba00f8fc761'
      },
      type: {
        type: 'string',
        description: 'Property type name',
        example: 'manufacturer'
      },
      string: {
        type: 'string',
        description: 'String value or referenced entity name',
        example: 'Prusament'
      },
      number: {
        type: 'number',
        description: 'Numeric value'
      },
      boolean: {
        type: 'boolean',
        description: 'Boolean value'
      },
      reference: {
        type: 'string',
        description: 'Referenced entity ID',
        example: '6798938532faaba00f8fc75f'
      },
      date: {
        type: 'string',
        format: 'date',
        description: 'Date value'
      },
      datetime: {
        type: 'string',
        format: 'date-time',
        description: 'Datetime value',
        example: '2025-01-28T08:21:25.637Z'
      },
      filename: {
        type: 'string',
        description: 'File name'
      },
      filesize: {
        type: 'integer',
        description: 'File size in bytes',
        minimum: 0
      },
      filetype: {
        type: 'string',
        description: 'MIME type',
        example: 'image/jpeg'
      },
      language: {
        type: 'string',
        description: 'Language code',
        example: 'en'
      },
      entity: {
        type: 'string',
        description: 'Parent entity ID',
        example: '6798938532faaba00f8fc75f'
      },
      created: {
        type: 'object',
        description: 'Creation metadata',
        properties: {
          at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp',
            example: '2025-01-28T08:21:25.637Z'
          },
          by: {
            type: 'string',
            description: 'User ID',
            example: '506e7c33dcb4b5c4fde735d0'
          }
        },
        required: ['at', 'by']
      }
    },
    required: ['_id', 'type', 'entity', 'created']
  }

  // Error - Standard error response format used across all API endpoints
  openapi.components.schemas.Error = {
    type: 'object',
    description: 'Error response.',
    properties: {
      error: {
        type: 'string',
        description: 'Error message'
      },
      statusCode: {
        type: 'integer',
        description: 'Status code',
        example: 400
      },
      statusMessage: {
        type: 'string',
        description: 'Status message',
        example: 'Bad Request'
      }
    },
    required: ['error', 'statusCode', 'statusMessage']
  }

  // Update API paths to reference the new schemas
  if (openapi.paths) {
    // Update error responses across all endpoints
    for (const path of Object.keys(openapi.paths)) {
      for (const method of Object.keys(openapi.paths[path])) {
        const operation = openapi.paths[path][method]

        if (operation.responses) {
          // Update common error responses
          for (const statusCode of ['400', '401', '403', '404', '500']) {
            if (operation.responses[statusCode]?.content?.['application/json']?.schema) {
              operation.responses[statusCode].content['application/json'].schema = {
                $ref: '#/components/schemas/Error'
              }
            }
          }
        }
      }
    }
  }

  return openapi
})
