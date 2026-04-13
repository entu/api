defineRouteMeta({
  openAPI: {
    tags: ['Entity'],
    description: 'List entities with filtering, full-text search, sorting, grouping, and pagination. Properties are filtered by access rights. See [query reference](https://entu.ee/api/query-reference).',
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
        name: 'props',
        in: 'query',
        schema: {
          type: 'string',
          description: 'Comma-separated list of properties to include'
        }
      },
      {
        name: 'group',
        in: 'query',
        schema: {
          type: 'string',
          description: 'Comma-separated list of grouping fields'
        }
      },
      {
        name: 'sort',
        in: 'query',
        schema: {
          type: 'string',
          description: 'Comma-separated list of sort fields'
        }
      },
      {
        name: 'limit',
        in: 'query',
        schema: {
          type: 'integer',
          default: 100,
          description: 'Maximum number of results to return'
        }
      },
      {
        name: 'skip',
        in: 'query',
        schema: {
          type: 'integer',
          default: 0,
          description: 'Number of results to skip'
        }
      },
      {
        name: 'q',
        in: 'query',
        schema: {
          type: 'string',
          description: 'Search query string'
        }
      },
      {
        name: '{property}.string',
        in: 'query',
        schema: {
          type: 'string',
          description: 'Filter by string property value (e.g., name.string=John)',
          example: 'name.string=John'
        }
      },
      {
        name: '{property}.string.regex',
        in: 'query',
        schema: {
          type: 'string',
          description: 'Filter by string property using regex (e.g., name.string.regex=/john/i)',
          example: 'name.string.regex=/john/i'
        }
      },
      {
        name: '{property}.string.in',
        in: 'query',
        schema: {
          type: 'string',
          description: 'Filter by multiple string values (comma-separated, e.g., status.string.in=active,pending)',
          example: 'status.string.in=active,pending'
        }
      },
      {
        name: '{property}.reference',
        in: 'query',
        schema: {
          type: 'string',
          description: 'Filter by reference property (entity ID, e.g., _type.reference=507f1f77bcf86cd799439011)',
          example: '_type.reference=507f1f77bcf86cd799439011'
        }
      },
      {
        name: '{property}.reference.in',
        in: 'query',
        schema: {
          type: 'string',
          description: 'Filter by multiple reference values (comma-separated entity IDs)',
          example: '_type.reference.in=507f1f77bcf86cd799439011,507f1f77bcf86cd799439012'
        }
      },
      {
        name: '{property}.reference.exists',
        in: 'query',
        schema: {
          type: 'boolean',
          description: 'Check if reference property exists (e.g., _parent.reference.exists=true)',
          example: '_parent.reference.exists=true'
        }
      },
      {
        name: '{property}.number',
        in: 'query',
        schema: {
          type: 'number',
          description: 'Filter by exact number value (e.g., price.number=100)',
          example: 'price.number=100'
        }
      },
      {
        name: '{property}.number.gt',
        in: 'query',
        schema: {
          type: 'number',
          description: 'Filter by number greater than (e.g., price.number.gt=100)',
          example: 'price.number.gt=100'
        }
      },
      {
        name: '{property}.number.gte',
        in: 'query',
        schema: {
          type: 'number',
          description: 'Filter by number greater than or equal (e.g., price.number.gte=100)',
          example: 'price.number.gte=100'
        }
      },
      {
        name: '{property}.number.lt',
        in: 'query',
        schema: {
          type: 'number',
          description: 'Filter by number less than (e.g., price.number.lt=100)',
          example: 'price.number.lt=100'
        }
      },
      {
        name: '{property}.number.lte',
        in: 'query',
        schema: {
          type: 'number',
          description: 'Filter by number less than or equal (e.g., price.number.lte=100)',
          example: 'price.number.lte=100'
        }
      },
      {
        name: '{property}.number.ne',
        in: 'query',
        schema: {
          type: 'number',
          description: 'Filter by number not equal (e.g., price.number.ne=0)',
          example: 'price.number.ne=0'
        }
      },
      {
        name: '{property}.number.in',
        in: 'query',
        schema: {
          type: 'string',
          description: 'Filter by multiple number values (comma-separated, e.g., quantity.number.in=10,20,30)',
          example: 'quantity.number.in=10,20,30'
        }
      },
      {
        name: '{property}.number.exists',
        in: 'query',
        schema: {
          type: 'boolean',
          description: 'Check if number property exists (e.g., price.number.exists=true)',
          example: 'price.number.exists=true'
        }
      },
      {
        name: '{property}.boolean',
        in: 'query',
        schema: {
          type: 'boolean',
          description: 'Filter by boolean value (e.g., active.boolean=true)',
          example: 'active.boolean=true'
        }
      },
      {
        name: '{property}.boolean.in',
        in: 'query',
        schema: {
          type: 'string',
          description: 'Filter by multiple boolean values (comma-separated, e.g., active.boolean.in=true,false)',
          example: 'active.boolean.in=true,false'
        }
      },
      {
        name: '{property}.boolean.exists',
        in: 'query',
        schema: {
          type: 'boolean',
          description: 'Check if boolean property exists (e.g., active.boolean.exists=true)',
          example: 'active.boolean.exists=true'
        }
      },
      {
        name: '{property}.date',
        in: 'query',
        schema: {
          type: 'string',
          format: 'date',
          description: 'Filter by exact date value (e.g., created_date.date=2025-01-28)',
          example: 'created_date.date=2025-01-28'
        }
      },
      {
        name: '{property}.date.gt',
        in: 'query',
        schema: {
          type: 'string',
          format: 'date',
          description: 'Filter by date greater than (e.g., created_date.date.gt=2025-01-01)',
          example: 'created_date.date.gt=2025-01-01'
        }
      },
      {
        name: '{property}.date.gte',
        in: 'query',
        schema: {
          type: 'string',
          format: 'date',
          description: 'Filter by date greater than or equal (e.g., created_date.date.gte=2025-01-01)',
          example: 'created_date.date.gte=2025-01-01'
        }
      },
      {
        name: '{property}.date.lt',
        in: 'query',
        schema: {
          type: 'string',
          format: 'date',
          description: 'Filter by date less than (e.g., created_date.date.lt=2025-12-31)',
          example: 'created_date.date.lt=2025-12-31'
        }
      },
      {
        name: '{property}.date.lte',
        in: 'query',
        schema: {
          type: 'string',
          format: 'date',
          description: 'Filter by date less than or equal (e.g., created_date.date.lte=2025-12-31)',
          example: 'created_date.date.lte=2025-12-31'
        }
      },
      {
        name: '{property}.date.in',
        in: 'query',
        schema: {
          type: 'string',
          description: 'Filter by multiple date values (comma-separated, e.g., event_date.date.in=2025-01-01,2025-02-01)',
          example: 'event_date.date.in=2025-01-01,2025-02-01'
        }
      },
      {
        name: '{property}.date.exists',
        in: 'query',
        schema: {
          type: 'boolean',
          description: 'Check if date property exists (e.g., birthdate.date.exists=true)',
          example: 'birthdate.date.exists=true'
        }
      },
      {
        name: '{property}.datetime',
        in: 'query',
        schema: {
          type: 'string',
          format: 'date-time',
          description: 'Filter by exact datetime value (e.g., created_at.datetime=2025-01-28T08:21:25.637Z)',
          example: 'created_at.datetime=2025-01-28T08:21:25.637Z'
        }
      },
      {
        name: '{property}.datetime.gt',
        in: 'query',
        schema: {
          type: 'string',
          format: 'date-time',
          description: 'Filter by datetime greater than',
          example: 'created_at.datetime.gt=2025-01-01T00:00:00.000Z'
        }
      },
      {
        name: '{property}.datetime.gte',
        in: 'query',
        schema: {
          type: 'string',
          format: 'date-time',
          description: 'Filter by datetime greater than or equal',
          example: 'created_at.datetime.gte=2025-01-01T00:00:00.000Z'
        }
      },
      {
        name: '{property}.datetime.lt',
        in: 'query',
        schema: {
          type: 'string',
          format: 'date-time',
          description: 'Filter by datetime less than',
          example: 'created_at.datetime.lt=2025-12-31T23:59:59.999Z'
        }
      },
      {
        name: '{property}.datetime.lte',
        in: 'query',
        schema: {
          type: 'string',
          format: 'date-time',
          description: 'Filter by datetime less than or equal',
          example: 'created_at.datetime.lte=2025-12-31T23:59:59.999Z'
        }
      },
      {
        name: '{property}.datetime.in',
        in: 'query',
        schema: {
          type: 'string',
          description: 'Filter by multiple datetime values (comma-separated)',
          example: 'created_at.datetime.in=2025-01-01T00:00:00.000Z,2025-02-01T00:00:00.000Z'
        }
      },
      {
        name: '{property}.datetime.exists',
        in: 'query',
        schema: {
          type: 'boolean',
          description: 'Check if datetime property exists (e.g., created_at.datetime.exists=true)',
          example: 'created_at.datetime.exists=true'
        }
      },
      {
        name: '{property}.filesize',
        in: 'query',
        schema: {
          type: 'number',
          description: 'Filter by exact file size in bytes (e.g., photo.filesize=1024000)',
          example: 'photo.filesize=1024000'
        }
      },
      {
        name: '{property}.filesize.gt',
        in: 'query',
        schema: {
          type: 'number',
          description: 'Filter by file size greater than (in bytes)',
          example: 'photo.filesize.gt=1000000'
        }
      },
      {
        name: '{property}.filesize.gte',
        in: 'query',
        schema: {
          type: 'number',
          description: 'Filter by file size greater than or equal (in bytes)',
          example: 'photo.filesize.gte=1000000'
        }
      },
      {
        name: '{property}.filesize.lt',
        in: 'query',
        schema: {
          type: 'number',
          description: 'Filter by file size less than (in bytes)',
          example: 'photo.filesize.lt=5000000'
        }
      },
      {
        name: '{property}.filesize.lte',
        in: 'query',
        schema: {
          type: 'number',
          description: 'Filter by file size less than or equal (in bytes)',
          example: 'photo.filesize.lte=5000000'
        }
      },
      {
        name: '{property}.filesize.in',
        in: 'query',
        schema: {
          type: 'string',
          description: 'Filter by multiple file size values (comma-separated)',
          example: 'photo.filesize.in=1024000,2048000'
        }
      },
      {
        name: '{property}.filesize.exists',
        in: 'query',
        schema: {
          type: 'boolean',
          description: 'Check if filesize property exists (e.g., photo.filesize.exists=true)',
          example: 'photo.filesize.exists=true'
        }
      },
      {
        name: '{property}.string.exists',
        in: 'query',
        schema: {
          type: 'boolean',
          description: 'Check if string property exists (e.g., name.string.exists=true)',
          example: 'name.string.exists=true'
        }
      }
    ],
    responses: {
      200: {
        description: 'List of entities with their properties',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              description: 'Paginated list of entities with metadata',
              properties: {
                entities: {
                  type: 'array',
                  description: 'Array of entity objects',
                  items: {
                    $ref: '#/components/schemas/Entity'
                  }
                },
                count: {
                  type: 'integer',
                  description: 'Total number of entities matching the query',
                  minimum: 0,
                  example: 14
                },
                limit: {
                  type: 'integer',
                  description: 'Maximum entities returned in this response',
                  minimum: 1,
                  example: 100
                },
                skip: {
                  type: 'integer',
                  description: 'Number of entities skipped',
                  minimum: 0,
                  example: 0
                }
              },
              required: ['entities', 'count', 'limit', 'skip']
            }
          }
        }
      },
      400: {
        description: 'Invalid regex filter',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      }
    }
  }
})

export default defineEventHandler(async (event) => {
  const entu = event.context.entu
  const query = getQuery(event)

  const props = (query.props || '').split(',').filter((x) => !!x)
  const group = (query.group || '').split(',').filter((x) => !!x)
  const fields = {}

  if (props.length > 0) {
    props.forEach((f) => {
      if (f === '_thumbnail' && !props.includes('photo')) {
        fields['private.photo'] = true
        fields['public.photo'] = true
      }
      else {
        fields[`private.${f}`] = true
        fields[`public.${f}`] = true
        fields[`domain.${f}`] = true
      }
    })
    fields.access = true
  }

  const sort = (query.sort || '').split(',').filter((x) => !!x)
  const limit = Number.parseInt(query.limit) || 100
  const skip = Number.parseInt(query.skip) || 0
  const q = (query.q || '').toLowerCase().split(' ').filter((x) => x.length > 0).map((term) => term.substring(0, 20)) // Truncate search terms to match index limit
  let sortFields = {}
  const filter = {}

  for (const k in query) {
    if (!k.includes('.'))
      continue

    const v = query[k]
    const fieldArray = k.split('.')
    const field = fieldArray.at(0)
    const type = fieldArray.at(1)
    const operator = fieldArray.at(2)
    let value

    switch (type) {
      case 'reference':
        value = operator === 'in' ? v.split(',').map(getObjectId) : getObjectId(v)
        break
      case 'boolean':
        value = operator === 'in' ? v.split(',').map((x) => x.toLowerCase() === 'true') : v.toLowerCase() === 'true'
        break
      case 'number':
        value = operator === 'in' ? v.split(',').map(Number) : Number(v)
        break
      case 'filesize':
        value = operator === 'in' ? v.split(',').map(Number) : Number(v)
        break
      case 'date':
        value = operator === 'in' ? v.split(',').map(parseDate) : parseDate(v)
        break
      case 'datetime':
        value = operator === 'in' ? v.split(',').map(parseDate) : parseDate(v)
        break
      default:
        if (operator === 'regex' && v.includes('/')) {
          const parts = v.split('/')
          const flags = (parts.at(2) || '').replace(/[^imsx]/g, '')
          try {
            value = new RegExp(parts.at(1), flags)
          }
          catch {
            throw createError({ statusCode: 400, statusMessage: 'Invalid regex' })
          }
        }
        else if (operator === 'exists') {
          value = v.toLowerCase() === 'true'
        }
        else if (operator === 'in') {
          value = v.split(',')
        }
        else {
          value = v
        }
    }

    if (['gt', 'gte', 'lt', 'lte', 'ne', 'regex', 'exists', 'in'].includes(operator)) {
      filter[`private.${field}.${type}`] = {
        ...filter[`private.${field}.${type}`] || {},
        [`$${operator}`]: value
      }
    }
    else {
      filter[`private.${field}.${type}`] = value
    }
  }

  if (entu.user) {
    filter.access = { $in: [entu.user, 'domain', 'public'] }
  }
  else {
    filter.access = 'public'
  }

  if (sort.length > 0) {
    sort.forEach((f) => {
      if (f.startsWith('-')) {
        sortFields[`private.${f.substring(1)}`] = -1
      }
      else {
        sortFields[`private.${f}`] = 1
      }
    })
  }
  else {
    sortFields = { _id: 1 }
  }

  if (q.length > 0) {
    if (entu.user) {
      filter['search.private'] = { $all: q }
    }
    else {
      filter['search.public'] = { $all: q }
    }
  }

  const cleanedEntities = []
  let pipeline = [{ $match: filter }]

  if (group.length > 0) {
    const groupIds = {}
    const groupFields = { access: { $first: '$access' } }
    const projectIds = {
      'public._count': '$_count',
      'private._count': '$_count',
      'domain._count': '$_count',
      access: true,
      _id: false
    }

    group.forEach((g) => {
      groupIds[g.replaceAll('.', '#')] = `$private.${g}`
    })

    Object.keys(fields).forEach((g) => {
      groupFields[g.replaceAll('.', '#')] = { $first: `$${g}` }
      projectIds[g] = `$${g.replaceAll('.', '#')}`
    })

    pipeline = [
      ...pipeline,
      { $group: { ...groupFields, _id: groupIds, _count: { $count: {} } } },
      { $project: projectIds },
      { $sort: sortFields }
    ]
  }
  else {
    pipeline.push({ $sort: sortFields })
    pipeline.push({ $skip: skip })
    pipeline.push({ $limit: limit })

    if (props.length > 0) {
      const projectIds = { access: true }

      Object.keys(fields).forEach((g) => {
        projectIds[g] = true
      })

      pipeline.push({ $project: projectIds })
    }
  }

  const countPipeline = [
    ...pipeline.filter((x) => !Object.keys(x).includes('$sort') && !Object.keys(x).includes('$skip') && !Object.keys(x).includes('$limit')),
    { $count: '_count' }
  ]

  const [entities, count] = await Promise.all([
    entu.db.collection('entity').aggregate(pipeline).toArray(),
    entu.db.collection('entity').aggregate(countPipeline).toArray()
  ])

  for (let i = 0; i < entities.length; i++) {
    const entity = await cleanupEntity(entu, entities[i], props.includes('_thumbnail'))

    if (entity)
      cleanedEntities.push(entity)
  }

  return {
    entities: cleanedEntities,
    count: count?.at(0)?._count || 0,
    limit,
    skip
  }
})

function parseDate (dateValue) {
  try {
    const timestampValue = Number(dateValue)

    if (Number.isNaN(timestampValue)) {
      return new Date(dateValue)
    }
    else {
      return new Date(timestampValue)
    }
  }
  catch {
    console.error('Error parsing date:', dateValue)

    return null
  }
}
