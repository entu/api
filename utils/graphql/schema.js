import { GraphQLScalarType, Kind } from 'graphql'
import { createSchema } from 'graphql-yoga'
import jwt from 'jsonwebtoken'

// Parses a GraphQL AST literal to a plain JS value
function parseLiteralValue (ast) {
  switch (ast.kind) {
    case Kind.INT: return Number.parseInt(ast.value, 10)
    case Kind.FLOAT: return Number.parseFloat(ast.value)
    case Kind.STRING: return ast.value
    case Kind.BOOLEAN: return ast.value === 'true'
    case Kind.NULL: return null
    default: return null
  }
}

// Creates a custom scalar that accepts both a bare value (wraps as { eq: value })
// and a filter object { eq, gt, lt, gte, lte, contains }
function makeFilterScalar (name, coerce, description) {
  return new GraphQLScalarType({
    name,
    description,
    parseValue (value) {
      return (typeof value === 'object' && value !== null) ? value : coerce(value)
    },
    parseLiteral (ast) {
      if (ast.kind === Kind.OBJECT) {
        const result = {}
        for (const field of ast.fields) {
          result[field.name.value] = parseLiteralValue(field.value)
        }
        return result
      }
      return coerce(parseLiteralValue(ast))
    },
    serialize (value) {
      return value
    }
  })
}

const FILTER_SCALARS = {
  StringFilter: makeFilterScalar('StringFilter', (v) => ({ eq: String(v) }), [
    'Filter strings by exact match or substring search.',
    'Use a bare string for exact match: `name: "John"`',
    'Or an object for substring search:',
    '  `name: { contains: "oh" }` — case-insensitive substring match'
  ].join('\n')),

  FloatFilter: makeFilterScalar('FloatFilter', (v) => ({ eq: Number(v) }), [
    'Filter numbers by exact match or range.',
    'Use a bare number for exact match: `age: 30`',
    'Or an object for range queries:',
    '  `age: { gt: 18 }`          — greater than',
    '  `age: { gte: 18 }`         — greater than or equal',
    '  `age: { lt: 65 }`          — less than',
    '  `age: { lte: 65 }`         — less than or equal',
    '  `age: { gte: 18, lt: 65 }` — combined range'
  ].join('\n')),

  BooleanFilter: makeFilterScalar('BooleanFilter', (v) => ({ eq: Boolean(v) }), [
    'Filter booleans by exact match.',
    'Use a bare value: `active: true`'
  ].join('\n')),

  IDFilter: makeFilterScalar('IDFilter', (v) => ({ eq: String(v) }), [
    'Filter reference properties by exact entity ID.',
    'Use a bare ID string: `owner: "507f1f77bcf86cd799439011"`'
  ].join('\n')),

  DateFilter: makeFilterScalar('DateFilter', (v) => ({ eq: String(v) }), [
    'Filter date and datetime properties using ISO strings.',
    'Use a bare string for exact match: `created: "2024-01-31"`',
    'Or an object for range queries:',
    '  `created: { gt: "2024-01-01" }`                      — after',
    '  `created: { gte: "2024-01-01" }`                     — on or after',
    '  `created: { lt: "2024-12-31" }`                      — before',
    '  `created: { lte: "2024-12-31" }`                     — on or before',
    '  `created: { gte: "2024-01-01", lte: "2024-12-31" }` — combined range'
  ].join('\n'))
}

const schemaCache = new Map()
const CACHE_TTL_MS = 5 * 60 * 1000

// Builds the auth + DB context for GraphQL route handlers (auto-imported by Nitro)
export async function buildEntuContext (event) {
  const { jwtSecret } = useRuntimeConfig(event)
  const account = formatDatabaseName(event.context.params?.db)

  if (!account) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid account parameter' })
  }

  const entu = {
    ip: getRequestIP(event, { xForwardedFor: true }),
    account
  }

  const tokenStr = (event.req.headers.get('authorization') || '').replace('Bearer ', '').trim()

  if (tokenStr) {
    try {
      entu.token = jwt.verify(tokenStr, jwtSecret)

      if (entu.token.aud && entu.token.aud !== entu.ip) {
        throw new Error('Invalid JWT audience')
      }
      if (entu.token.accounts?.[account]) {
        entu.user = getObjectId(entu.token.accounts[account])
        entu.userStr = entu.token.accounts[account]
      }
      if (entu.token?.user?.email) {
        entu.email = entu.token.user.email
      }
    }
    catch (e) {
      throw createError({ statusCode: 401, statusMessage: e.message || String(e) })
    }
  }

  entu.db = await connectDb(account)
  return entu
}

// Returns a cached (or freshly built) GraphQL schema for the given user context (auto-imported by Nitro)
export async function getOrBuildSchema (entu) {
  const cacheKey = `${entu.account}:${entu.userStr || 'anonymous'}`
  const cached = schemaCache.get(cacheKey)

  if (cached && Date.now() - cached.builtAt < CACHE_TTL_MS) {
    return cached.schema
  }

  const hash = await computeSchemaHash(entu)

  if (cached && hash === cached.hash) {
    schemaCache.set(cacheKey, { schema: cached.schema, builtAt: Date.now(), hash })
    return cached.schema
  }

  const schema = await buildSchema(entu)
  schemaCache.set(cacheKey, { schema, builtAt: Date.now(), hash })
  return schema
}

async function computeSchemaHash (entu) {
  const accessFilter = entu.user ? { $in: [entu.user, 'domain', 'public'] } : 'public'

  const result = await entu.db.collection('entity').aggregate([
    {
      $match: {
        access: accessFilter,
        $or: [
          { 'private._type.string': 'entity' },
          { 'private._type.string': 'property' }
        ]
      }
    },
    { $group: { _id: null, count: { $sum: 1 }, latestId: { $max: '$_id' } } }
  ]).toArray()

  if (!result.length)
    return '0:null'
  return `${result[0].count}:${result[0].latestId}`
}

const STATIC_BASE_TYPES = `
"A text property value"
type StringValue {
  "Property record ID"
  _id: ID
  "Text value"
  string: String
}
"A multilingual text property value"
type StringValueLanguage {
  "Property record ID"
  _id: ID
  "Text value"
  string: String
  "Language code (e.g. en, et)"
  language: String
}
"A numeric property value"
type FloatValue {
  "Property record ID"
  _id: ID
  "Numeric value"
  number: Float
}
"A multilingual numeric property value"
type FloatValueLanguage {
  "Property record ID"
  _id: ID
  "Numeric value"
  number: Float
  "Language code (e.g. en, et)"
  language: String
}
"A boolean property value"
type BooleanValue {
  "Property record ID"
  _id: ID
  "Boolean value"
  boolean: Boolean
}
"A multilingual boolean property value"
type BooleanValueLanguage {
  "Property record ID"
  _id: ID
  "Boolean value"
  boolean: Boolean
  "Language code (e.g. en, et)"
  language: String
}
"A reference property value linking to another entity"
type ReferenceValue {
  "Property record ID"
  _id: ID
  "Referenced entity ID"
  reference: ID
  "Display name of the referenced entity"
  string: String
}
"A multilingual reference property value linking to another entity"
type ReferenceValueLanguage {
  "Property record ID"
  _id: ID
  "Referenced entity ID"
  reference: ID
  "Display name of the referenced entity"
  string: String
  "Language code (e.g. en, et)"
  language: String
}
"A date property value"
type DateValue {
  "Property record ID"
  _id: ID
  "Date value (ISO 8601, e.g. 2024-01-31)"
  date: String
}
"A multilingual date property value"
type DateValueLanguage {
  "Property record ID"
  _id: ID
  "Date value (ISO 8601, e.g. 2024-01-31)"
  date: String
  "Language code (e.g. en, et)"
  language: String
}
"A datetime property value"
type DatetimeValue {
  "Property record ID"
  _id: ID
  "Datetime value (ISO 8601, e.g. 2024-01-31T12:00:00.000Z)"
  datetime: String
}
"A multilingual datetime property value"
type DatetimeValueLanguage {
  "Property record ID"
  _id: ID
  "Datetime value (ISO 8601, e.g. 2024-01-31T12:00:00.000Z)"
  datetime: String
  "Language code (e.g. en, et)"
  language: String
}
"A file property value"
type FileValue {
  "Property record ID"
  _id: ID
  "Original filename"
  filename: String
  "File size in bytes"
  filesize: Int
  "MIME type"
  filetype: String
  "Signed download URL"
  url: String
}
"A multilingual file property value"
type FileValueLanguage {
  "Property record ID"
  _id: ID
  "Original filename"
  filename: String
  "File size in bytes"
  filesize: Int
  "MIME type"
  filetype: String
  "Signed download URL"
  url: String
  "Language code (e.g. en, et)"
  language: String
}

"Sharing level of an entity"
enum Sharing { public domain private }

scalar StringFilter
scalar FloatFilter
scalar BooleanFilter
scalar IDFilter
scalar DateFilter

input MultilingualStringInput { string: String!, language: String }
`.trim()

async function buildSchema (entu) {
  const accessFilter = entu.user ? { $in: [entu.user, 'domain', 'public'] } : 'public'

  // Fetch entity type definitions
  const typeDocs = await entu.db.collection('entity').find({
    access: accessFilter,
    'private._type.string': 'entity',
    'private.name.string': { $exists: true }
  }, {
    projection: { _id: true, 'private.name': true, 'private.label': true, 'private.description': true }
  }).toArray()

  if (typeDocs.length === 0) {
    return createSchema({
      typeDefs: 'type Query { _empty: String } type Mutation { _empty: String }',
      resolvers: { Query: { _empty: () => null }, Mutation: { _empty: () => null } }
    })
  }

  const typeIds = typeDocs.map((t) => t._id)

  // Fetch property definitions for those types
  const propDocs = await entu.db.collection('entity').find({
    access: accessFilter,
    'private._type.string': 'property',
    'private._parent.reference': { $in: typeIds },
    'private.name.string': { $exists: true },
    'private.type.string': { $exists: true }
  }, {
    projection: {
      _id: true,
      'private._parent': true,
      'private.name': true,
      'private.type': true,
      'private.list': true,
      'private.multilingual': true,
      'private.mandatory': true,
      'private.formula': true,
      'private.set': true,
      'private.readonly': true,
      'private.label': true,
      'private.description': true
    }
  }).toArray()

  // Process entity types
  const entityTypes = typeDocs.map((doc) => ({
    _id: doc._id,
    name: doc.private.name.at(0).string,
    description: pickDescription(doc.private.description) || pickDescription(doc.private.label)
  }))

  // Group prop defs by parent type _id
  const propsByTypeId = {}
  for (const doc of propDocs) {
    const parentId = doc.private._parent?.at(0)?.reference?.toString()
    if (!parentId)
      continue

    const propDef = {
      _id: doc._id,
      name: doc.private.name.at(0).string,
      type: doc.private.type.at(0).string,
      list: doc.private.list?.at(0)?.boolean || false,
      multilingual: doc.private.multilingual?.at(0)?.boolean || false,
      mandatory: doc.private.mandatory?.at(0)?.boolean || false,
      formula: doc.private.formula?.at(0)?.boolean || false,
      readonly: doc.private.readonly?.at(0)?.boolean || false,
      set: doc.private.set?.map((s) => s.string).filter(Boolean) || [],
      description: pickDescription(doc.private.description) || pickDescription(doc.private.label)
    }

    if (!propsByTypeId[parentId])
      propsByTypeId[parentId] = []
    propsByTypeId[parentId].push(propDef)
  }

  // Build SDL
  const sdlParts = [STATIC_BASE_TYPES]
  const queryFields = []
  const mutationFields = []

  // Track used type names to avoid duplicates
  const usedTypeNames = new Set()

  for (const entityType of entityTypes) {
    const rawTypeName = toGqlTypeName(entityType.name)
    // Deduplicate: skip if already used
    if (usedTypeNames.has(rawTypeName))
      continue
    usedTypeNames.add(rawTypeName)

    const typeName = rawTypeName
    const fieldName = toGqlFieldName(entityType.name)
    const propDefs = propsByTypeId[entityType._id.toString()] || []

    // --- Output type ---
    const outputFields = [
      '  "Entity ID"',
      '  _id: ID!',
      '  "Entity type"',
      '  _type: [ReferenceValue]',
      '  "Parent entities"',
      '  _parent: [ReferenceValue]',
      '  "Owners — can change rights"',
      '  _owner: [ReferenceValue]',
      '  "Editors — can add/edit/delete properties"',
      '  _editor: [ReferenceValue]',
      '  "Expanders — can add child entities"',
      '  _expander: [ReferenceValue]',
      '  "Viewers — can see private entities"',
      '  _viewer: [ReferenceValue]',
      '  "Sharing level"',
      '  _sharing: Sharing',
      '  "Inherit access rights from parent entities"',
      '  _inheritrights: BooleanValue'
    ]
    for (const p of propDefs) {
      const gqlField = toGqlFieldName(p.name)
      const outputType = getOutputType(p)
      const desc = sdlDescription(p.description, '  ')
      outputFields.push(`${desc}  ${gqlField}: ${outputType}`)
    }
    const typeDesc = sdlDescription(entityType.description)
    sdlParts.push(`${typeDesc}type ${typeName} {\n${outputFields.join('\n')}\n}`)

    // --- Input type (exclude formula, counter, file, readonly) ---
    const inputFields = []
    for (const p of propDefs) {
      if (p.formula || p.readonly || p.type === 'counter' || p.type === 'file')
        continue
      const gqlField = toGqlFieldName(p.name)
      const inputType = getInputType(p)
      inputFields.push(`  ${gqlField}: ${inputType}`)
    }
    if (inputFields.length > 0) {
      sdlParts.push(`input ${typeName}Input {\n${inputFields.join('\n')}\n}`)
    }

    // --- Filter type ---
    const filterFields = ['  _id: ID', '  _search: String']
    for (const p of propDefs) {
      const gqlField = toGqlFieldName(p.name)
      const filterType = getFilterType(p.type)
      filterFields.push(`  ${gqlField}: ${filterType}`)
    }
    sdlParts.push(`input ${typeName}Filter {\n${filterFields.join('\n')}\n}`)

    // --- Query field ---
    queryFields.push(`  ${fieldName}(limit: Int, skip: Int, filter: ${typeName}Filter): [${typeName}!]!`)

    // --- Mutation fields ---
    if (inputFields.length > 0) {
      mutationFields.push(`  ${fieldName}Create(input: ${typeName}Input!): ${typeName}!`)
      mutationFields.push(`  ${fieldName}Update(id: ID!, input: ${typeName}Input!): ${typeName}!`)
    }
    mutationFields.push(`  ${fieldName}Delete(id: ID!): Boolean!`)
  }

  if (queryFields.length === 0) {
    queryFields.push('  _empty: String')
  }
  if (mutationFields.length === 0) {
    mutationFields.push('  _empty: String')
  }

  sdlParts.push(`type Query {\n${queryFields.join('\n')}\n}`)
  sdlParts.push(`type Mutation {\n${mutationFields.join('\n')}\n}`)

  const typeDefs = sdlParts.join('\n\n')
  const resolvers = { ...buildResolvers(entityTypes, propsByTypeId), ...FILTER_SCALARS }

  return createSchema({ typeDefs, resolvers })
}

// Picks the best description string: no language → EN → any other
function pickDescription (values) {
  if (!values || values.length === 0)
    return null
  return (
    values.find((v) => !v.language && v.string)?.string
    || values.find((v) => v.language === 'en' && v.string)?.string
    || values.find((v) => v.string)?.string
    || null
  )
}

// Formats a description string as a SDL block-string with optional indent
function sdlDescription (text, indent = '') {
  if (!text)
    return ''
  return `${indent}"""${text.replace(/"""/g, '\\"\\"\\"')}"""\n`
}

function getOutputType (propDef) {
  const baseType = getBaseOutputType(propDef.type, propDef.multilingual)
  return propDef.list ? `[${baseType}]` : baseType
}

function getBaseOutputType (entuType, multilingual) {
  switch (entuType) {
    case 'string':
    case 'text': return multilingual ? 'StringValueLanguage' : 'StringValue'
    case 'counter': return 'StringValue'
    case 'number': return multilingual ? 'FloatValueLanguage' : 'FloatValue'
    case 'boolean': return multilingual ? 'BooleanValueLanguage' : 'BooleanValue'
    case 'reference': return multilingual ? 'ReferenceValueLanguage' : 'ReferenceValue'
    case 'date': return multilingual ? 'DateValueLanguage' : 'DateValue'
    case 'datetime': return multilingual ? 'DatetimeValueLanguage' : 'DatetimeValue'
    case 'file': return multilingual ? 'FileValueLanguage' : 'FileValue'
    default: return multilingual ? 'StringValueLanguage' : 'StringValue'
  }
}

function getInputType (propDef) {
  if (propDef.multilingual)
    return '[MultilingualStringInput]'

  const scalar = getScalarInputType(propDef.type)
  return propDef.list ? `[${scalar}]` : scalar
}

function getScalarInputType (entuType) {
  switch (entuType) {
    case 'number': return 'Float'
    case 'boolean': return 'Boolean'
    case 'reference': return 'ID'
    case 'date':
    case 'datetime': return 'String'
    default: return 'String'
  }
}

function getFilterType (entuType) {
  switch (entuType) {
    case 'string':
    case 'text':
    case 'counter': return 'StringFilter'
    case 'number': return 'FloatFilter'
    case 'boolean': return 'BooleanFilter'
    case 'reference': return 'IDFilter'
    case 'date':
    case 'datetime': return 'DateFilter'
    default: return 'StringFilter'
  }
}
