defineRouteMeta({ openAPI: { hidden: true } })

export default defineEventHandler(async () => {
  // Get the original OpenAPI spec from the default route
  const openapi = await $fetch('/_openapi.json')

  // Keep only documented routes - a hidden method is dropped on its own, so a public method on the same path stays
  if (openapi.paths) {
    openapi.paths = Object.fromEntries(
      Object.entries(openapi.paths)
        .filter(([path]) => !path.startsWith('/docs') && !path.startsWith('/graphql') && !path.startsWith('/_'))
        .map(([path, methods]) => [path, Object.fromEntries(Object.entries(methods).filter(([, op]) => !op?.hidden))])
        .filter(([, methods]) => Object.keys(methods).length > 0)
    )
  }

  // Add additional OpenAPI metadata that Nitro config doesn't support
  openapi.servers = [
    {
      url: 'https://api.entu.app'
    }
  ]

  openapi.info.description = 'REST API for [Entu](https://entu.ee), a schema-less entity-property database. Start with the [quick start](https://entu.ee/api/quickstart/), then see [authentication](https://entu.ee/api/authentication/) and [best practices](https://entu.ee/api/best-practices/).'

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
      description: '12-hour JWT, bound to the issuing IP unless it came from `POST /auth/token`. See [authentication flow](https://entu.ee/api/authentication/#authentication-flow).'
    }
  }

  // Set global security to only show Bearer Auth option
  openapi.security = [{ bearerAuth: [] }]

  openapi.tags = [
    {
      name: 'Authentication',
      description: 'Get a 12-hour JWT from an API key or login, or through Entu\'s [OAuth 2.1 server](https://entu.ee/api/authentication/#oauth-server). See [authentication](https://entu.ee/api/authentication/).'
    },
    {
      name: 'Database',
      description: 'Database statistics and limits.'
    },
    {
      name: 'Entity',
      description: 'Create, read, update and delete [entities](https://entu.ee/overview/entities/). See the [query reference](https://entu.ee/api/query-reference/) and [formulas](https://entu.ee/api/formulas/).'
    },
    {
      name: 'Property',
      description: 'Read or delete single [property](https://entu.ee/overview/properties/) values.'
    }
  ]

  // Models - Core data structures for the Entu API
  if (!openapi.components.schemas) {
    openapi.components.schemas = {}
  }

  // Entity - the caller's private, domain or public view of an entity, each property an array of values
  openapi.components.schemas.Entity = {
    type: 'object',
    description: 'Entity with only the properties the caller [may read](https://entu.ee/overview/entities/#access-rights), each an array of values.',
    properties: {
      _id: {
        type: 'string',
        description: 'Entity ID — absent in grouped results',
        example: '6798938432faaba00f8fc72f'
      },
      _type: {
        type: 'array',
        description: 'Entity type — `reference` is the type entity ID, `string` its name',
        items: {
          $ref: '#/components/schemas/PropertyValue'
        }
      },
      _parent: {
        type: 'array',
        description: 'Parent entities',
        items: {
          $ref: '#/components/schemas/PropertyValue'
        }
      },
      _owner: {
        type: 'array',
        description: 'Owners — only in the private view',
        items: {
          $ref: '#/components/schemas/PropertyValue'
        }
      },
      _created: {
        type: 'array',
        description: 'Creation time (`datetime`) and creator (`reference`)',
        items: {
          $ref: '#/components/schemas/PropertyValue'
        }
      },
      _sharing: {
        type: 'array',
        description: 'Sharing level — `string` is `private`, `domain` or `public`',
        items: {
          $ref: '#/components/schemas/PropertyValue'
        }
      },
      _count: {
        type: 'integer',
        description: 'Number of entities in the group — only in grouped results',
        minimum: 1
      }
    },
    additionalProperties: {
      type: 'array',
      description: 'Dynamic properties defined by the entity type',
      items: {
        $ref: '#/components/schemas/PropertyValue'
      }
    }
  }

  // PropertyValue - one value of a property as embedded in an entity, without the property document's own metadata
  openapi.components.schemas.PropertyValue = {
    type: 'object',
    description: 'One property value with the field for its type; [credential properties](https://entu.ee/api/authentication/#auth-properties) are masked.',
    properties: {
      _id: {
        type: 'string',
        description: 'Property ID — use it with `/{db}/property/{_id}`; absent for computed formula values',
        example: '6798938532faaba00f8fc761'
      },
      string: {
        type: 'string',
        description: 'String value, or the name of the referenced entity on a reference',
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
      property_type: {
        type: 'string',
        description: 'On a reference: the property name',
        example: 'manufacturer'
      },
      entity_type: {
        type: 'string',
        description: 'On a reference: the referenced entity\'s type name',
        example: 'manufacturer'
      },
      inherited: {
        type: 'boolean',
        description: 'On a rights property: the right comes from a parent entity'
      },
      date: {
        type: 'string',
        format: 'date-time',
        description: 'Date value, serialized as an ISO 8601 datetime'
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
      }
    },
    additionalProperties: true
  }

  // Property - a single property document as returned by the property endpoints
  openapi.components.schemas.Property = {
    type: 'object',
    description: 'Property with its entity, creation metadata and the value field for its type.',
    properties: {
      _id: {
        type: 'string',
        description: 'Property ID',
        example: '6798938532faaba00f8fc761'
      },
      type: {
        type: 'string',
        description: 'Property name',
        example: 'manufacturer'
      },
      entity: {
        type: 'string',
        description: 'ID of the entity this property belongs to',
        example: '6798938532faaba00f8fc75f'
      },
      string: {
        type: 'string',
        description: 'String value',
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
        format: 'date-time',
        description: 'Date value, serialized as an ISO 8601 datetime'
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
      url: {
        type: 'string',
        description: 'Signed download URL, valid for 60 seconds — file properties only'
      },
      language: {
        type: 'string',
        description: 'Language code',
        example: 'en'
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
            description: 'ID of the person who created it, or `entu` for the system',
            example: '506e7c33dcb4b5c4fde735d0'
          }
        },
        required: ['at', 'by']
      }
    },
    additionalProperties: true,
    required: ['_id', 'type', 'entity', 'created']
  }

  // Error - the body Nitro's error handler sends for every thrown error
  openapi.components.schemas.Error = {
    type: 'object',
    description: 'Error response.',
    properties: {
      error: {
        type: 'boolean',
        description: 'Always true',
        example: true
      },
      url: {
        type: 'string',
        description: 'Request URL',
        example: 'https://api.entu.app/mydatabase/entity/6798938432faaba00f8fc72f'
      },
      status: {
        type: 'integer',
        description: 'HTTP status code',
        example: 404
      },
      statusText: {
        type: 'string',
        description: 'Error message — absent on an unexpected server error',
        example: 'Entity 6798938432faaba00f8fc72f not found'
      },
      message: {
        type: 'string',
        description: 'Error message — `Server Error` on an unexpected server error',
        example: 'Entity 6798938432faaba00f8fc72f not found'
      },
      data: {
        type: 'object',
        description: 'Extra details — OAuth `error` and `error_description`',
        properties: {
          error: {
            type: 'string',
            description: 'OAuth error code',
            example: 'invalid_grant'
          },
          error_description: {
            type: 'string',
            description: 'OAuth error description',
            example: 'PKCE verification failed'
          }
        },
        additionalProperties: true
      }
    },
    required: ['error', 'url', 'status', 'message']
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
