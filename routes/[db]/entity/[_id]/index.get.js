defineRouteMeta({
  openAPI: {
    tags: ['Entity'],
    description: 'Get an entity in the view (private, domain or public) the caller may read; credential values are masked. See [property values](https://entu.ee/api/properties/) and [access rights](https://entu.ee/overview/entities/#access-rights).',
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
        name: 'props',
        in: 'query',
        schema: {
          type: 'string',
          description: 'Comma-separated properties or `property.field` paths to return; `_id` is always returned',
          example: 'name,_type'
        }
      }
    ],
    responses: {
      200: {
        description: 'Entity: `_id` plus an array of values per property',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              description: 'Single entity response wrapper',
              properties: {
                entity: {
                  $ref: '#/components/schemas/Entity'
                }
              },
              required: ['entity']
            }
          }
        }
      },
      400: {
        description: 'Invalid ID or invalid database name',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      },
      401: {
        description: 'Invalid or expired JWT, or JWT audience does not match caller IP',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      },
      403: {
        description: 'No accessible properties',
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
  const query = getQuery(event)

  const props = (query.props || '').split(',').filter((x) => !!x)
  const fields = {}

  if (props.length > 0) {
    for (const f of props) {
      fields[`private.${f}`] = true
      fields[`public.${f}`] = true
      fields[`domain.${f}`] = true
    }
    fields.access = true
  }

  const entityId = getObjectId(getRouterParam(event, '_id'))

  const entity = await entu.db.collection('entity').findOne({
    _id: entityId
  }, {
    projection: fields
  })

  if (!entity) {
    throw createError({
      statusCode: 404,
      statusMessage: `Entity ${entityId} not found`
    })
  }

  const cleanedEntity = await cleanupEntity(entu, entity)

  if (!cleanedEntity) {
    throw createError({
      statusCode: 403,
      statusMessage: 'No accessible properties'
    })
  }

  return {
    entity: cleanedEntity
  }
})
