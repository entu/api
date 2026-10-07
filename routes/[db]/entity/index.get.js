defineRouteMeta({
  openAPI: {
    tags: ['Entity'],
    description: 'List entities with filters, full-text search, sorting, grouping and pagination; anonymous callers get public entities only. Filters are `{property}.{field}[.{operator}]=value` and all must match; an unknown operator matches exactly. See the [query reference](https://entu.ee/api/query-reference/#filters).',
    security: [{}, { bearerAuth: [] }], // The token is optional; without it only public entities are listed
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
          description: 'Comma-separated properties or `property.field` paths to return; `_id` is always returned. See [field selection](https://entu.ee/api/query-reference/#field-selection).',
          example: 'name,_type,_created'
        }
      },
      {
        name: 'group',
        in: 'query',
        schema: {
          type: 'string',
          description: 'Comma-separated `property.field` paths to group by; grouped values appear only if also in `props`. See [grouping](https://entu.ee/api/query-reference/#grouping).',
          example: 'status.string'
        }
      },
      {
        name: 'sort',
        in: 'query',
        schema: {
          type: 'string',
          description: 'Comma-separated `property.field` paths, `-` prefix for descending; default `_id` (creation order). See [sorting](https://entu.ee/api/query-reference/#sorting).',
          example: 'name.string,-_created.datetime'
        }
      },
      {
        name: 'limit',
        in: 'query',
        schema: {
          type: 'integer',
          default: 100,
          minimum: 1,
          description: 'Maximum entities to return; `0` or non-numeric means 100, no upper bound. Ignored with `group`.'
        }
      },
      {
        name: 'skip',
        in: 'query',
        schema: {
          type: 'integer',
          default: 0,
          minimum: 0,
          description: 'Entities to skip. Ignored with `group`.'
        }
      },
      {
        name: 'q',
        in: 'query',
        schema: {
          type: 'string',
          description: 'Full-text search. See [full-text search](https://entu.ee/api/query-reference/#full-text-search).',
          example: 'acme corp'
        }
      },
      {
        name: '{property}.string',
        in: 'query',
        schema: {
          type: 'string',
          description: 'Exact match against any value; reference values carry the referenced entity\'s name here. `gt`, `gte`, `lt`, `lte`, `ne` also work.',
          example: 'name.string=John'
        }
      },
      {
        name: '{property}.string.regex',
        in: 'query',
        schema: {
          type: 'string',
          description: '`/pattern/flags` with flags i, m, s (others dropped, `x` returns 400); a value without `/` is the pattern as-is',
          example: 'name.string.regex=/john/i'
        }
      },
      {
        name: '{property}.string.in',
        in: 'query',
        schema: {
          type: 'string',
          description: 'Any of the comma-separated values',
          example: 'status.string.in=active,pending'
        }
      },
      {
        name: '{property}.string.ne',
        in: 'query',
        schema: {
          type: 'string',
          description: 'No value equals this; includes entities without the property',
          example: 'status.string.ne=archived'
        }
      },
      {
        name: '{property}.{field}',
        in: 'query',
        schema: {
          type: 'string',
          description: 'Any other value field (`filename`, `filetype`, `language`, …), compared as a string with the `.string` operators',
          example: 'photo.filetype=image/jpeg'
        }
      },
      {
        name: '{property}.reference',
        in: 'query',
        schema: {
          type: 'string',
          description: 'Referenced entity ID; an invalid ID returns 400',
          example: '_parent.reference=507f1f77bcf86cd799439011'
        }
      },
      {
        name: '{property}.reference.in',
        in: 'query',
        schema: {
          type: 'string',
          description: 'Any of the comma-separated entity IDs; an invalid ID returns 400',
          example: '_type.reference.in=507f1f77bcf86cd799439011,507f1f77bcf86cd799439012'
        }
      },
      {
        name: '{property}.reference.ne',
        in: 'query',
        schema: {
          type: 'string',
          description: 'Does not reference this ID; includes entities without the property',
          example: '_parent.reference.ne=507f1f77bcf86cd799439011'
        }
      },
      {
        name: '{property}.reference.exists',
        in: 'query',
        schema: {
          type: 'boolean',
          description: 'Value exists (`true`) or not (`false`)',
          example: '_parent.reference.exists=true'
        }
      },
      {
        name: '{property}.number',
        in: 'query',
        schema: {
          type: 'number',
          description: 'Exact number',
          example: 'price.number=100'
        }
      },
      {
        name: '{property}.number.gt',
        in: 'query',
        schema: {
          type: 'number',
          description: 'Greater than',
          example: 'price.number.gt=100'
        }
      },
      {
        name: '{property}.number.gte',
        in: 'query',
        schema: {
          type: 'number',
          description: 'Greater than or equal',
          example: 'price.number.gte=100'
        }
      },
      {
        name: '{property}.number.lt',
        in: 'query',
        schema: {
          type: 'number',
          description: 'Less than',
          example: 'price.number.lt=100'
        }
      },
      {
        name: '{property}.number.lte',
        in: 'query',
        schema: {
          type: 'number',
          description: 'Less than or equal',
          example: 'price.number.lte=100'
        }
      },
      {
        name: '{property}.number.ne',
        in: 'query',
        schema: {
          type: 'number',
          description: 'Not equal',
          example: 'price.number.ne=0'
        }
      },
      {
        name: '{property}.number.in',
        in: 'query',
        schema: {
          type: 'string',
          description: 'Any of the comma-separated numbers',
          example: 'quantity.number.in=10,20,30'
        }
      },
      {
        name: '{property}.number.exists',
        in: 'query',
        schema: {
          type: 'boolean',
          description: 'Value exists (`true`) or not (`false`)',
          example: 'price.number.exists=true'
        }
      },
      {
        name: '{property}.boolean',
        in: 'query',
        schema: {
          type: 'boolean',
          description: 'Boolean value; anything but `true` means `false`',
          example: 'active.boolean=true'
        }
      },
      {
        name: '{property}.boolean.in',
        in: 'query',
        schema: {
          type: 'string',
          description: 'Any of the comma-separated booleans',
          example: 'active.boolean.in=true,false'
        }
      },
      {
        name: '{property}.boolean.exists',
        in: 'query',
        schema: {
          type: 'boolean',
          description: 'Value exists (`true`) or not (`false`)',
          example: 'active.boolean.exists=true'
        }
      },
      {
        name: '{property}.date',
        in: 'query',
        schema: {
          type: 'string',
          format: 'date',
          description: 'Exact date; date and datetime filters also take a Unix timestamp in milliseconds',
          example: 'created_date.date=2025-01-28'
        }
      },
      {
        name: '{property}.date.gt',
        in: 'query',
        schema: {
          type: 'string',
          format: 'date',
          description: 'Greater than',
          example: 'created_date.date.gt=2025-01-01'
        }
      },
      {
        name: '{property}.date.gte',
        in: 'query',
        schema: {
          type: 'string',
          format: 'date',
          description: 'Greater than or equal',
          example: 'created_date.date.gte=2025-01-01'
        }
      },
      {
        name: '{property}.date.lt',
        in: 'query',
        schema: {
          type: 'string',
          format: 'date',
          description: 'Less than',
          example: 'created_date.date.lt=2025-12-31'
        }
      },
      {
        name: '{property}.date.lte',
        in: 'query',
        schema: {
          type: 'string',
          format: 'date',
          description: 'Less than or equal',
          example: 'created_date.date.lte=2025-12-31'
        }
      },
      {
        name: '{property}.date.in',
        in: 'query',
        schema: {
          type: 'string',
          description: 'Any of the comma-separated dates',
          example: 'event_date.date.in=2025-01-01,2025-02-01'
        }
      },
      {
        name: '{property}.date.exists',
        in: 'query',
        schema: {
          type: 'boolean',
          description: 'Value exists (`true`) or not (`false`)',
          example: 'birthdate.date.exists=true'
        }
      },
      {
        name: '{property}.datetime',
        in: 'query',
        schema: {
          type: 'string',
          format: 'date-time',
          description: 'Exact datetime',
          example: 'created_at.datetime=2025-01-28T08:21:25.637Z'
        }
      },
      {
        name: '{property}.datetime.gt',
        in: 'query',
        schema: {
          type: 'string',
          format: 'date-time',
          description: 'Greater than',
          example: 'created_at.datetime.gt=2025-01-01T00:00:00.000Z'
        }
      },
      {
        name: '{property}.datetime.gte',
        in: 'query',
        schema: {
          type: 'string',
          format: 'date-time',
          description: 'Greater than or equal',
          example: 'created_at.datetime.gte=2025-01-01T00:00:00.000Z'
        }
      },
      {
        name: '{property}.datetime.lt',
        in: 'query',
        schema: {
          type: 'string',
          format: 'date-time',
          description: 'Less than',
          example: 'created_at.datetime.lt=2025-12-31T23:59:59.999Z'
        }
      },
      {
        name: '{property}.datetime.lte',
        in: 'query',
        schema: {
          type: 'string',
          format: 'date-time',
          description: 'Less than or equal',
          example: 'created_at.datetime.lte=2025-12-31T23:59:59.999Z'
        }
      },
      {
        name: '{property}.datetime.in',
        in: 'query',
        schema: {
          type: 'string',
          description: 'Any of the comma-separated datetimes',
          example: 'created_at.datetime.in=2025-01-01T00:00:00.000Z,2025-02-01T00:00:00.000Z'
        }
      },
      {
        name: '{property}.datetime.exists',
        in: 'query',
        schema: {
          type: 'boolean',
          description: 'Value exists (`true`) or not (`false`)',
          example: 'created_at.datetime.exists=true'
        }
      },
      {
        name: '{property}.filesize',
        in: 'query',
        schema: {
          type: 'number',
          description: 'Exact file size in bytes',
          example: 'photo.filesize=1024000'
        }
      },
      {
        name: '{property}.filesize.gt',
        in: 'query',
        schema: {
          type: 'number',
          description: 'Greater than',
          example: 'photo.filesize.gt=1000000'
        }
      },
      {
        name: '{property}.filesize.gte',
        in: 'query',
        schema: {
          type: 'number',
          description: 'Greater than or equal',
          example: 'photo.filesize.gte=1000000'
        }
      },
      {
        name: '{property}.filesize.lt',
        in: 'query',
        schema: {
          type: 'number',
          description: 'Less than',
          example: 'photo.filesize.lt=5000000'
        }
      },
      {
        name: '{property}.filesize.lte',
        in: 'query',
        schema: {
          type: 'number',
          description: 'Less than or equal',
          example: 'photo.filesize.lte=5000000'
        }
      },
      {
        name: '{property}.filesize.in',
        in: 'query',
        schema: {
          type: 'string',
          description: 'Any of the comma-separated sizes',
          example: 'photo.filesize.in=1024000,2048000'
        }
      },
      {
        name: '{property}.filesize.exists',
        in: 'query',
        schema: {
          type: 'boolean',
          description: 'File exists (`true`) or not (`false`)',
          example: 'photo.filesize.exists=true'
        }
      },
      {
        name: '{property}.string.exists',
        in: 'query',
        schema: {
          type: 'boolean',
          description: 'Value exists (`true`) or not (`false`)',
          example: 'name.string.exists=true'
        }
      }
    ],
    responses: {
      200: {
        description: 'List of entities',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              description: 'Paginated list of entities',
              properties: {
                entities: {
                  type: 'array',
                  description: 'Entities in the view the caller may read; with `group`, rows of `_count` and `props` values, without `_id`',
                  items: {
                    $ref: '#/components/schemas/Entity'
                  }
                },
                count: {
                  type: 'integer',
                  description: 'Total matches, or number of groups with `group`',
                  minimum: 0,
                  example: 14
                },
                limit: {
                  type: 'integer',
                  description: 'Limit applied',
                  minimum: 1,
                  example: 100
                },
                skip: {
                  type: 'integer',
                  description: 'Skip applied',
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
        description: 'Invalid regex, invalid ID in a reference filter, or invalid database name',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      },
      401: {
        description: 'Invalid or expired JWT, or JWT audience does not match caller IP',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      },
      404: {
        description: 'Account not found',
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

  const sort = (query.sort || '').split(',').filter((x) => !!x)
  const limit = Number.parseInt(query.limit) || 100
  const skip = Number.parseInt(query.skip) || 0
  const search = (query.q || '').split(' ').filter((x) => x.length > 0)
  const filter = {}

  for (const k in query) {
    if (!k.includes('.')) continue

    const v = query[k]
    const fieldArray = k.split('.')
    const field = fieldArray.at(0)
    const type = fieldArray.at(1)
    const operator = fieldArray.at(2)

    if (!/^\w+$/.test(field) || !/^\w+$/.test(type)) continue

    const value = parseFilterValue(type, operator, v)

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

  return await queryEntities(entu, { filter, search, props, group, sort, limit, skip })
})

// Converts a filter's query value to the field's type - `exists` takes true or false for every type, never a typed value
function parseFilterValue (type, operator, v) {
  if (operator === 'exists') {
    return v.toLowerCase() === 'true'
  }

  switch (type) {
    case 'reference':
      return operator === 'in' ? v.split(',').map(getObjectId) : getObjectId(v)
    case 'boolean':
      return operator === 'in' ? v.split(',').map((x) => x.toLowerCase() === 'true') : v.toLowerCase() === 'true'
    case 'number':
    case 'filesize':
      return operator === 'in' ? v.split(',').map(Number) : Number(v)
    case 'date':
    case 'datetime':
      return operator === 'in' ? v.split(',').map(parseDate) : parseDate(v)
    default:
      if (operator === 'regex' && v.includes('/')) {
        const parts = v.split('/')
        const flags = (parts.at(2) || '').replace(/[^imsx]/g, '')

        try {
          return new RegExp(parts.at(1), flags)
        }
        catch {
          throw createError({ statusCode: 400, statusMessage: 'Invalid regex' })
        }
      }

      return operator === 'in' ? v.split(',') : v
  }
}

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
    return null
  }
}
