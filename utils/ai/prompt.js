const summaryTypesLimit = 100
const summarySizeLimit = 30000

// Prompt template (comment stripped, static {{operators}} filled) read once from the bundled asset and cached for the process lifetime
let cachedTemplate

// Builds the system prompt: fills the per-request value placeholders in the cached template. All prose lives in ai/system-prompt.md
export async function aiBuildSystemPrompt (entu) {
  const [template, types] = await Promise.all([
    getTemplate(),
    getTypeSummaries(entu)
  ])

  const today = new Date().toISOString().slice(0, 10)

  // Function replacers so `$` in user-entered configuration data is not treated as a replacement pattern
  return template
    .replaceAll('{{today}}', () => today)
    .replaceAll('{{account}}', () => entu.account)
    .replaceAll('{{configuration}}', () => renderConfiguration(types))
}

// Loads the prompt template from server assets, strips the comment, fills the static operator list, and caches the result
async function getTemplate () {
  if (cachedTemplate) {
    return cachedTemplate
  }

  const template = await useStorage('assets:server').getItem('ai/system-prompt.md')

  if (typeof template !== 'string' || template.length === 0) {
    throw createError({
      statusCode: 500,
      statusMessage: 'AI system prompt template not found'
    })
  }

  cachedTemplate = template
    .replace(/^<!--[\s\S]*?-->\s*/, '')
    .replaceAll('{{operators}}', renderOperators())
    .trim()

  return cachedTemplate
}

// Renders the operator list from the formula engine's registry, so new operators can't silently go missing from the prompt
function renderOperators () {
  const operators = getFormulaOperators()
  const tokens = Object.keys(operators)
  const variadic = tokens.filter((token) => operators[token] === 'all')
  const fixed = tokens.filter((token) => operators[token] !== 'all')

  return [
    `- Variadic (consume the whole stack): ${variadic.join(', ')}`,
    `- Fixed arity: ${fixed.map((token) => `${token} (${operators[token]})`).join(', ')}`
  ].join('\n')
}

// Fetches all entity type definitions with their property definitions, filtered by the calling user's read access.
// No $sort stages — private.* fields are parallel arrays MongoDB refuses to sort on; sorting happens in JS below.
async function getTypeSummaries (entu) {
  const types = await entu.db.collection('entity').aggregate([
    {
      $match: {
        'private._type.string': 'entity',
        'private.name.string': { $exists: true },
        access: { $in: [entu.user, 'domain', 'public'] }
      }
    },
    {
      $lookup: {
        from: 'entity',
        let: { typeId: '$_id' },
        pipeline: [
          {
            $match: {
              'private._type.string': 'property',
              'private.name.string': { $exists: true },
              access: { $in: [entu.user, 'domain', 'public'] },
              $expr: { $in: ['$$typeId', { $ifNull: ['$private._parent.reference', []] }] }
            }
          },
          {
            $project: {
              _id: false,
              name: { $arrayElemAt: ['$private.name.string', 0] },
              type: { $arrayElemAt: ['$private.type.string', 0] },
              ordinal: { $arrayElemAt: ['$private.ordinal.number', 0] },
              mandatory: { $arrayElemAt: ['$private.mandatory.boolean', 0] },
              multilingual: { $arrayElemAt: ['$private.multilingual.boolean', 0] },
              list: { $arrayElemAt: ['$private.list.boolean', 0] },
              readonly: { $arrayElemAt: ['$private.readonly.boolean', 0] },
              formula: { $arrayElemAt: ['$private.formula.string', 0] }
            }
          }
        ],
        as: 'properties'
      }
    },
    {
      $project: {
        _id: false,
        name: { $arrayElemAt: ['$private.name.string', 0] },
        label: { $arrayElemAt: ['$private.label.string', 0] },
        properties: true
      }
    }
  ]).toArray()

  for (const type of types) {
    type.properties.sort(comparePropertyDefinitions)
  }

  return types.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
}

// Orders property definitions by ordinal (missing last), then by name — matching the webapp's ordering
function comparePropertyDefinitions (a, b) {
  const ordinalA = typeof a.ordinal === 'number' ? a.ordinal : Number.MAX_SAFE_INTEGER
  const ordinalB = typeof b.ordinal === 'number' ? b.ordinal : Number.MAX_SAFE_INTEGER

  if (ordinalA !== ordinalB) {
    return ordinalA - ordinalB
  }

  return (a.name || '').localeCompare(b.name || '')
}

// Renders the configuration listing — full property listing, or type names only when the database is too large
function renderConfiguration (types) {
  if (types.length === 0) {
    return 'This database has no entity types yet.'
  }

  const full = renderFullConfiguration(types)

  if (types.length <= summaryTypesLimit && full.length <= summarySizeLimit) {
    return full
  }

  const names = types.map((t) => t.name).join(', ')

  return `This database has ${types.length} entity types: ${names}\n\nThe full listing is too large to include here — use the get_entity_type tool to inspect a type's property definitions.`
}

// Renders every type as a heading with one line per property definition
function renderFullConfiguration (types) {
  const lines = ['Entity types and their property definitions currently in this database:']

  for (const type of types) {
    lines.push('', type.label ? `### ${type.name} — "${type.label}"` : `### ${type.name}`)

    for (const property of type.properties) {
      const flags = []

      if (property.mandatory) {
        flags.push('mandatory')
      }
      if (property.multilingual) {
        flags.push('multilingual')
      }
      if (property.list) {
        flags.push('list')
      }
      if (property.readonly) {
        flags.push('readonly')
      }
      if (property.formula) {
        flags.push(`formula: ${property.formula}`)
      }

      const suffix = flags.length > 0 ? ` (${flags.join(', ')})` : ''

      lines.push(`- ${property.name}: ${property.type || 'string'}${suffix}`)
    }
  }

  return lines.join('\n')
}
