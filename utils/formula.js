// Evaluates a formula string and returns the computed value
export async function formula (entu, str, entityId, localValues = {}) {
  const strArray = await parseFormulaTokens(entu, str, entityId, localValues)

  // If single value and it's a nested formula result, return it directly
  if (strArray.length === 1) {
    const token = strArray.at(0)
    const value = await formulaField(entu, token, entityId, localValues)

    if (value !== undefined && value !== null) {
      const valueArray = await getValueArray(entu, value)

      if (valueArray.length === 1) {
        const val = valueArray.at(0)

        if (typeof val === 'number') {
          return { number: val }
        }

        return { string: val }
      }
    }
  }

  const func = formulaFunction(strArray)
  const data = formulaContent(strArray, func)

  let valueArray = []

  for (let i = 0; i < data.length; i++) {
    const value = await formulaField(entu, data[i], entityId, localValues)

    if (value !== undefined && value !== null) {
      valueArray = [...valueArray, ...value]
    }
  }

  valueArray = await getValueArray(entu, valueArray)

  if (valueArray.length === 0 && !['COUNT', 'SUM', 'MULTIPLY'].includes(func)) {
    return undefined
  }

  switch (func) {
    case 'COUNT':
      return { number: valueArray.length }
    case 'SUM':
      return { number: valueArray.reduce((a, b) => a + b, 0) }
    case 'SUBTRACT':
      return { number: valueArray.slice(1).reduce((a, b) => a - b, valueArray.at(0)) }
    case 'MULTIPLY':
      return { number: valueArray.reduce((a, b) => a * b, 1) }
    case 'DIVIDE':
      if (valueArray.slice(1).includes(0)) {
        return undefined
      }
      return { number: valueArray.slice(1).reduce((a, b) => a / b, valueArray.at(0)) }
    case 'AVERAGE':
      return { number: valueArray.reduce((a, b) => a + b, 0) / valueArray.length }
    case 'MIN':
      return { number: Math.min(...valueArray) }
    case 'MAX':
      return { number: Math.max(...valueArray) }
    case 'ABS':
      return { number: Math.abs(valueArray.at(0)) }
    case 'ROUND':
      return { number: Number(valueArray.at(0).toFixed(valueArray.at(-1))) }
    case 'CONCAT_WS':
      return { string: valueArray.slice(0, -1).join(valueArray.at(-1)) }
    default: // CONCAT
      return { string: valueArray.join('') }
  }
}

// Splits a formula string into tokens, resolving nested sub-formulas recursively
async function parseFormulaTokens (entu, str, entityId, localValues = {}) {
  const tokens = []
  let current = ''
  let inQuote = null
  let parenDepth = 0
  let parenStart = -1

  for (let i = 0; i < str.length; i++) {
    const char = str.at(i)
    const prevChar = str.at(i - 1)

    // Handle quoted strings
    if (inQuote) {
      current += char

      if (char === inQuote && prevChar !== '\\') {
        inQuote = null
      }

      continue
    }

    if (char === '"' || char === '\'') {
      inQuote = char
      current += char

      continue
    }

    // Handle parentheses (nested formulas)
    if (char === '(') {
      if (parenDepth === 0) {
        if (current.trim())
          tokens.push(current.trim())
        current = ''
        parenStart = i
      }

      parenDepth++

      continue
    }

    if (char === ')') {
      parenDepth--

      if (parenDepth === 0) {
        const nestedFormula = str.substring(parenStart + 1, i)
        const result = await formula(entu, nestedFormula, entityId, localValues)

        if (result?.number !== undefined) {
          tokens.push(result.number.toString())
        }
        else if (result?.string !== undefined) {
          tokens.push(`"${result.string}"`)
        }

        current = ''
      }

      continue
    }

    // Skip content inside parentheses
    if (parenDepth > 0)
      continue

    // Handle regular tokens
    if (/\s/.test(char)) {
      if (current.trim())
        tokens.push(current.trim())

      current = ''
    }
    else {
      current += char
    }
  }

  if (current.trim())
    tokens.push(current.trim())

  return tokens
}

// Resolves a single formula token into a value array from the database
async function formulaField (entu, str, entityId, localValues = {}) {
  str = str.trim()

  if ((str.startsWith('\'') || str.startsWith('"')) && (str.endsWith('\'') || str.endsWith('"'))) {
    return [{
      string: str.substring(1, str.length - 1)
    }]
  }

  if (Number.parseFloat(str).toString() === str) {
    return [{
      number: Number.parseFloat(str)
    }]
  }

  const strParts = str.split('.').filter((x) => x !== undefined)
  const [fieldRef, fieldType, fieldProperty] = strParts

  let result

  if (strParts.length === 1 && str === '_id') { // same entity _id
    result = [{ _id: entityId }]
  }
  else if (strParts.length === 1 && str !== '_id') { // same entity property
    if (localValues[str]) { // Use in-memory value from current aggregation pass (e.g. another formula result)
      result = localValues[str]
    }
    else {
      result = await entu.db.collection('property').find({
        entity: entityId,
        type: str,
        deleted: { $exists: false }
      }, {
        projection: { _id: true, entity: false, type: false, created: false }
      }).toArray()

      if (result.length === 0) { // Fall back to persisted entity document (pre-aggregation state)
        result = await entu.db.collection('entity').aggregate([{
          $match: {
            _id: entityId
          }
        }, {
          $project: {
            property: `$private.${str}`
          }
        }, {
          $unwind: '$property'
        }, {
          $replaceWith: '$property'
        }]).toArray()
      }
    }
  }
  else if (strParts.length === 3 && fieldRef === '_referrer' && fieldType === '*' && fieldProperty === '_id') { // referrer entities _id
    result = await entu.db.collection('entity').find({
      'private._reference.reference': entityId
    }, {
      projection: { _id: true }
    }).toArray()
  }
  else if (strParts.length === 3 && fieldRef === '_referrer' && fieldType !== '*' && fieldProperty === '_id') { // referrer entities (with type) _id
    result = await entu.db.collection('entity').find({
      'private._reference.reference': entityId,
      'private._type.string': fieldType
    }, {
      projection: { _id: true }
    }).toArray()
  }
  else if (strParts.length === 3 && fieldRef === '_referrer' && fieldType === '*' && fieldProperty !== '_id') { // referrer entities property
    result = await entu.db.collection('entity').aggregate([{
      $match: {
        'private._reference.reference': entityId
      }
    }, {
      $project: {
        property: `$private.${fieldProperty}`
      }
    }, {
      $unwind: '$property'
    }, {
      $replaceWith: '$property'
    }]).toArray()
  }
  else if (strParts.length === 3 && fieldRef === '_referrer' && fieldType !== '*' && fieldProperty !== '_id') { // referrer entities (with type) property
    result = await entu.db.collection('entity').aggregate([{
      $match: {
        'private._reference.reference': entityId,
        'private._type.string': fieldType
      }
    }, {
      $project: {
        property: `$private.${fieldProperty}`
      }
    }, {
      $unwind: '$property'
    }, {
      $replaceWith: '$property'
    }]).toArray()
  }
  else if (strParts.length === 3 && fieldRef === '_child' && fieldType === '*' && fieldProperty === '_id') { // childs _id
    result = await entu.db.collection('entity').find({
      'private._parent.reference': entityId
    }, {
      projection: { _id: true }
    }).toArray()
  }
  else if (strParts.length === 3 && fieldRef === '_child' && fieldType !== '*' && fieldProperty === '_id') { // childs (with type) property
    result = await entu.db.collection('entity').find({
      'private._parent.reference': entityId,
      'private._type.string': fieldType
    }, {
      projection: { _id: true }
    }).toArray()
  }
  else if (strParts.length === 3 && fieldRef === '_child' && fieldType === '*' && fieldProperty !== '_id') { // childs property
    result = await entu.db.collection('entity').aggregate([{
      $match: {
        'private._parent.reference': entityId
      }
    }, {
      $project: {
        property: `$private.${fieldProperty}`
      }
    }, {
      $unwind: '$property'
    }, {
      $replaceWith: '$property'
    }]).toArray()
  }
  else if (strParts.length === 3 && fieldRef === '_child' && fieldType !== '*' && fieldProperty !== '_id') { // childs (with type) property
    result = await entu.db.collection('entity').aggregate([{
      $match: {
        'private._parent.reference': entityId,
        'private._type.string': fieldType
      }
    }, {
      $project: {
        property: `$private.${fieldProperty}`
      }
    }, {
      $unwind: '$property'
    }, {
      $replaceWith: '$property'
    }]).toArray()
  }
  else if (strParts.length === 3 && fieldRef !== '_child' && fieldType === '*' && fieldProperty === '_id') { // other reference _id
    result = await entu.db.collection('property').aggregate([{
      $match: {
        entity: entityId,
        type: fieldRef,
        reference: { $exists: true },
        deleted: { $exists: false }
      }
    }, {
      $project: { _id: '$reference' }
    }]).toArray()
  }
  else if (strParts.length === 3 && fieldRef !== '_child' && fieldType !== '*' && fieldProperty === '_id') { // other reference (with type) _id
    result = await entu.db.collection('property').aggregate([{
      $match: {
        entity: entityId,
        type: fieldRef,
        reference: { $exists: true },
        deleted: { $exists: false }
      }
    }, {
      $lookup: {
        from: 'entity',
        let: { entityId: '$reference' },
        pipeline: [
          {
            $match: {
              'private._type.string': fieldType,
              $expr: { $eq: ['$_id', '$$entityId'] }
            }
          },
          {
            $project: { _id: true }
          }
        ],
        as: 'references'
      }
    }, {
      $unwind: '$references'
    }, {
      $replaceWith: '$references'
    }]).toArray()
  }
  else if (strParts.length === 3 && fieldRef !== '_child' && fieldType === '*' && fieldProperty !== '_id') { // other reference property
    result = await entu.db.collection('property').aggregate([{
      $match: {
        entity: entityId,
        type: fieldRef,
        reference: { $exists: true },
        deleted: { $exists: false }
      }
    }, {
      $lookup: {
        from: 'entity',
        let: { entityId: '$reference' },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ['$_id', '$$entityId'] }
            }
          },
          {
            $project: { property: `$private.${fieldProperty}` }
          }
        ],
        as: 'references'
      }
    }, {
      $project: {
        property: '$references.property'
      }
    }, {
      $unwind: '$property'
    }, {
      $unwind: '$property'
    }, {
      $replaceWith: '$property'
    }]).toArray()
  }
  else if (strParts.length === 3 && fieldRef !== '_child' && fieldType !== '*' && fieldProperty !== '_id') { // other references(with type) property
    result = await entu.db.collection('property').aggregate([{
      $match: {
        entity: entityId,
        type: fieldRef,
        reference: { $exists: true },
        deleted: { $exists: false }
      }
    }, {
      $lookup: {
        from: 'entity',
        let: { entityId: '$reference' },
        pipeline: [
          {
            $match: {
              'private._type.string': fieldType,
              $expr: { $eq: ['$_id', '$$entityId'] }
            }
          },
          {
            $project: { property: `$private.${fieldProperty}` }
          }
        ],
        as: 'references'
      }
    }, {
      $project: {
        property: '$references.property'
      }
    }, {
      $unwind: '$property'
    }, {
      $unwind: '$property'
    }, {
      $replaceWith: '$property'
    }]).toArray()
  }

  return result
}

// Extracts the aggregation function keyword from the last token in a list
function formulaFunction (data) {
  const func = data.at(-1)

  if (['CONCAT', 'CONCAT_WS', 'COUNT', 'SUM', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'AVERAGE', 'MIN', 'MAX', 'ABS', 'ROUND'].includes(func)) {
    return func
  }
  else {
    return 'CONCAT'
  }
}

// Returns the data tokens without the trailing function keyword
function formulaContent (data, func) {
  if (data.at(-1) === func) {
    return data.slice(0, -1)
  }
  else {
    return data
  }
}

// Converts a property value array into a flat array of primitive values
export async function getValueArray (entu, values) {
  if (!values)
    return []

  // Batch-fetch all referenced entities in one query instead of one findOne() per value
  const refIds = values.filter((x) => x.reference != null).map((x) => x.reference)
  const refMap = new Map()

  if (refIds.length > 0) {
    const refDocs = await entu.db.collection('entity').find(
      { _id: { $in: refIds } },
      { projection: { 'private.name': true } }
    ).toArray()

    for (const doc of refDocs) {
      refMap.set(doc._id.toString(), doc)
    }
  }

  return values.map((x) => {
    try {
      if (x.number !== undefined && x.number !== null)
        return x.number
      if (x.datetime !== undefined && x.datetime !== null)
        return x.datetime?.toISOString()
      if (x.date !== undefined && x.date !== null)
        return x.date?.toISOString().substring(0, 10)
      if (x.string !== undefined && x.string !== null)
        return x.string
      if (x.reference !== undefined && x.reference !== null) {
        const entity = refMap.get(x.reference.toString())

        return entity?.private?.name?.at(0)?.string || x.reference
      }

      return x._id
    }
    catch (error) {
      loggerError(`getValueArray ${x._id} ${error}`, entu)

      return x._id
    }
  })
}
