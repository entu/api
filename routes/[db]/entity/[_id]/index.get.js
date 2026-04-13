defineRouteMeta({
  openAPI: {
    tags: ['Entity'],
    description: 'Get entity by ID. Returns properties filtered by access rights. Use `props` to request specific properties only.',
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
      },
      {
        name: 'props',
        in: 'query',
        schema: {
          type: 'string',
          description: 'Comma-separated list of properties to include. If not set, all properties are returned.'
        }
      }
    ],
    responses: {
      200: {
        description: 'Entity with all properties in flattened structure',
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
      403: {
        description: 'No accessible properties',
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
  const query = getQuery(event)

  const props = (query.props || '').split(',').filter((x) => !!x)
  const fields = {}
  let getThumbnail = props.length === 0

  if (props.length > 0) {
    props.forEach((f) => {
      if (f === '_thumbnail') {
        fields['private.photo'] = true
        fields['public.photo'] = true
        getThumbnail = true
      }
      else {
        fields[`private.${f}`] = true
        fields[`public.${f}`] = true
        fields[`domain.${f}`] = true
      }
    })
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

  const cleanedEntity = await cleanupEntity(entu, entity, getThumbnail)

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
