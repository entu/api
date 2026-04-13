// Converts a raw DB entity/property name to a valid GraphQL field name (camelCase)
export function toGqlFieldName (name) {
  const segments = name.split(/[\s_-]+/).map((s) => s.replace(/[^A-Z0-9]/gi, '')).filter(Boolean)
  if (segments.length === 0)
    return 'unknown'
  const result = segments
    .map((s, i) => i === 0
      ? s.charAt(0).toLowerCase() + s.slice(1)
      : s.charAt(0).toUpperCase() + s.slice(1))
    .join('')
  return /^\d/.test(result) ? `f${result}` : (result || 'unknown')
}

// Converts a raw DB entity/property name to a valid GraphQL type name (PascalCase)
export function toGqlTypeName (name) {
  const segments = name.split(/[\s_-]+/).map((s) => s.replace(/[^A-Z0-9]/gi, '')).filter(Boolean)
  if (segments.length === 0)
    return 'Unknown'
  const result = segments.map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join('')
  return /^\d/.test(result) ? `T${result}` : (result || 'Unknown')
}

// Builds a MongoDB filter object from GraphQL filter args (excludes the access filter)
export function buildMongoFilter (filterArgs, propDefs) {
  const filter = {}

  for (const [key, value] of Object.entries(filterArgs)) {
    if (value === undefined || value === null)
      continue

    // _search and _id handled separately in the query resolver
    if (key === '_search' || key === '_id')
      continue

    const propDef = propDefs.find((p) => toGqlFieldName(p.name) === key)
    if (!propDef || typeof value !== 'object')
      continue

    const mongoPath = getMongoFieldPath(propDef.type, propDef.name)

    for (const [op, opValue] of Object.entries(value)) {
      if (opValue === undefined || opValue === null)
        continue

      if (op === 'eq') {
        filter[mongoPath] = coerceValue(propDef.type, opValue)
      }
      else if (op === 'contains') {
        filter[mongoPath] = { ...(filter[mongoPath] || {}), $regex: opValue, $options: 'i' }
      }
      else if (['gt', 'lt', 'gte', 'lte'].includes(op)) {
        filter[mongoPath] = { ...(filter[mongoPath] || {}), [`$${op}`]: coerceValue(propDef.type, opValue) }
      }
    }
  }

  return filter
}

function getMongoFieldPath (entuType, propName) {
  switch (entuType) {
    case 'string':
    case 'text':
    case 'counter':
      return `private.${propName}.string`
    case 'number':
      return `private.${propName}.number`
    case 'boolean':
      return `private.${propName}.boolean`
    case 'reference':
      return `private.${propName}.reference`
    case 'date':
      return `private.${propName}.date`
    case 'datetime':
      return `private.${propName}.datetime`
    default:
      return `private.${propName}.string`
  }
}

function coerceValue (entuType, value) {
  switch (entuType) {
    case 'number': return Number(value)
    case 'boolean': return value === true || value === 'true'
    case 'reference': return getObjectId(value)
    case 'date':
    case 'datetime': return new Date(value)
    default: return value
  }
}
