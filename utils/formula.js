// Strict-RPN formula engine.
//
// A formula is a whitespace-separated sequence of tokens evaluated left-to-right
// against a single value stack. Each token is either:
//   - a literal (number, string, boolean) — pushes one slot,
//   - a field reference — pushes one slot containing zero, one, or many values,
//   - an operator — pops N slots, computes, pushes one slot.
//
// A "slot" is an array of primitive values (because Entu properties are multi-value).
// Operators come in three flavours:
//   - variadic reducers (arity 'all') consume the entire stack,
//   - fixed-arity ops pop a declared number of slots,
//   - per-value ops apply to every underlying value in their input slot.
//
// If a formula does not end with a recognized operator keyword, an implicit
// CONCAT is appended.

// Evaluates a formula string and returns the computed property value(s).
// Returns one of: { number }, { string }, { boolean }, an array of those objects
// (when the result is multi-value), or undefined (no property written).
export async function formula (entu, str, entityId, localValues = {}) {
  const tokens = parseFormulaTokens(str)

  if (tokens.length === 0) {
    return
  }

  // Implicit CONCAT: append CONCAT if the formula doesn't end with a recognized operator.
  const lastToken = tokens.at(-1)

  if (!lookupOperator(lastToken)) {
    tokens.push('CONCAT')
  }

  const stack = []

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens.at(i)
    const op = lookupOperator(token)

    if (op) {
      let args

      if (op.arity === 'all') {
        args = stack.splice(0, stack.length)
      }
      else {
        if (stack.length < op.arity) {
          return // not enough operands on the stack
        }

        args = stack.splice(stack.length - op.arity, op.arity)
      }

      const result = await op.fn(args, { entu, entityId, localValues })

      if (result === undefined) {
        return
      }

      stack.push(result)
    }
    else {
      // Push a value slot (literal or field reference)
      const value = await formulaField(entu, token, entityId, localValues)
      const slot = await getValueArray(entu, value)
      stack.push(slot)
    }
  }

  if (stack.length !== 1) {
    return
  }

  return wrapResult(stack.at(0))
}

// Wraps the final stack slot into property value object(s) or returns undefined.
function wrapResult (slot) {
  if (!slot || slot.length === 0) {
    return
  }

  if (slot.length === 1) {
    return wrapValue(slot.at(0))
  }

  // Multi-value result — return an array of value objects.
  const wrapped = slot.map(wrapValue).filter((v) => v !== undefined)

  if (wrapped.length === 0) {
    return
  }

  return wrapped
}

function wrapValue (value) {
  if (value === undefined || value === null) {
    return
  }

  if (typeof value === 'number') {
    return { number: value }
  }

  if (typeof value === 'boolean') {
    return { boolean: value }
  }

  // Coerce anything else (ObjectId, etc.) into a real string so the property
  // value isn't stored as a non-string object inside `{ string: … }`.
  return { string: typeof value === 'string' ? value : String(value) }
}

// Tokenizes a formula string. Whitespace-separated tokens, with quoted strings
// (single or double) preserved as single tokens including their surrounding quotes.
function parseFormulaTokens (str) {
  if (typeof str !== 'string') {
    return []
  }

  const tokens = []
  let current = ''
  let inQuote = null

  for (let i = 0; i < str.length; i++) {
    const char = str.at(i)
    const prevChar = str.at(i - 1)

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

    if (/\s/.test(char)) {
      if (current.trim()) {
        tokens.push(current.trim())
      }

      current = ''
    }
    else {
      current += char
    }
  }

  if (current.trim()) {
    tokens.push(current.trim())
  }

  return tokens
}

// Resolves a single formula token into the underlying property value array from the database
async function formulaField (entu, str, entityId, localValues = {}) {
  str = str.trim()

  if ((str.startsWith('\'') || str.startsWith('"')) && (str.endsWith('\'') || str.endsWith('"'))) {
    return [{
      string: str.slice(1, -1)
    }]
  }

  if (str === 'true' || str === 'false') {
    return [{
      boolean: str === 'true'
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
      if (x.boolean !== undefined && x.boolean !== null)
        return x.boolean
      if (x.number !== undefined && x.number !== null)
        return x.number
      if (x.datetime !== undefined && x.datetime !== null)
        return x.datetime?.toISOString()
      if (x.date !== undefined && x.date !== null)
        return x.date?.toISOString().slice(0, 10)
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

// ---------------------------------------------------------------------------
// Operator implementations
// ---------------------------------------------------------------------------

// Flatten a list of slots into a single value array, in push order.
function flattenSlots (slots) {
  const flat = []

  for (const slot of slots) {
    for (const v of slot) {
      flat.push(v)
    }
  }

  return flat
}

// All-stack reducer: string concatenation, no separator.
// Uses Array.prototype.join which coerces null/undefined to empty string —
// matching legacy behaviour when fields resolve to value objects with no
// recognized typed field.
function opConcat (slots) {
  const values = flattenSlots(slots)

  if (values.length === 0) {
    return
  }

  return [values.join('')]
}

// All-stack reducer: last value is separator, rest are joined with it.
// Same null/undefined-as-empty rule as opConcat.
function opConcatWs (slots) {
  const values = flattenSlots(slots)

  if (values.length === 0) {
    return // nothing on stack
  }

  if (values.length === 1) {
    return // only a separator, nothing to join
  }

  const rawSeparator = values.at(-1)
  const separator = rawSeparator === null || rawSeparator === undefined ? '' : String(rawSeparator)

  return [values.slice(0, -1).join(separator)]
}

// All-stack reducer: strict numeric sum.
function opSum (slots) {
  const values = flattenSlots(slots)

  if (values.length === 0) {
    return
  }

  if (values.some((v) => typeof v !== 'number')) {
    return
  }

  return [values.reduce((a, b) => a + b, 0)]
}

// All-stack reducer: first value minus the rest.
function opSubtract (slots) {
  const values = flattenSlots(slots)

  if (values.length === 0) {
    return
  }

  if (values.some((v) => typeof v !== 'number')) {
    return
  }

  return [values.slice(1).reduce((a, b) => a - b, values.at(0))]
}

// All-stack reducer: product of all values.
function opMultiply (slots) {
  const values = flattenSlots(slots)

  if (values.length === 0) {
    return
  }

  if (values.some((v) => typeof v !== 'number')) {
    return
  }

  return [values.reduce((a, b) => a * b, 1)]
}

// All-stack reducer: first value divided by the rest. Division by zero → undefined.
function opDivide (slots) {
  const values = flattenSlots(slots)

  if (values.length === 0) {
    return
  }

  if (values.some((v) => typeof v !== 'number')) {
    return
  }

  if (values.slice(1).includes(0)) {
    return
  }

  return [values.slice(1).reduce((a, b) => a / b, values.at(0))]
}

// All-stack reducer: count of underlying values. Empty stack → 0.
function opCount (slots) {
  const values = flattenSlots(slots)

  return [values.length]
}

// All-stack reducer: arithmetic mean.
function opAverage (slots) {
  const values = flattenSlots(slots)

  if (values.length === 0) {
    return
  }

  if (values.some((v) => typeof v !== 'number')) {
    return
  }

  return [values.reduce((a, b) => a + b, 0) / values.length]
}

// All-stack reducer: smallest value (homogeneous type — all numbers or all strings).
function opMin (slots) {
  const values = flattenSlots(slots)

  if (values.length === 0) {
    return
  }

  if (!homogeneousComparable(values)) {
    return
  }

  let min = values.at(0)

  for (const v of values.slice(1)) {
    if (v < min)
      min = v
  }

  return [min]
}

// All-stack reducer: largest value (homogeneous type — all numbers or all strings).
function opMax (slots) {
  const values = flattenSlots(slots)

  if (values.length === 0) {
    return
  }

  if (!homogeneousComparable(values)) {
    return
  }

  let max = values.at(0)

  for (const v of values.slice(1)) {
    if (v > max)
      max = v
  }

  return [max]
}

function homogeneousComparable (values) {
  const t = typeof values.at(0)

  if (t !== 'number' && t !== 'string') {
    return false
  }

  return values.every((v) => typeof v === t)
}

// All-stack reducer: first slot = needle, rest of slots = haystack. ANY semantics.
function opIn (slots) {
  if (slots.length === 0) {
    return
  }

  const needle = slots.at(0)
  const haystack = new Set(flattenSlots(slots.slice(1)))

  for (const n of needle) {
    if (haystack.has(n)) {
      return [true]
    }
  }

  return [false]
}

function opNin (slots) {
  const inResult = opIn(slots)

  if (inResult === undefined) {
    return
  }

  return [!inResult.at(0)]
}

// Binary comparisons with ANY semantics across the cross product.
function makeBinaryComparison (compare, requireSameOrderableType) {
  return function (slots) {
    const left = slots.at(0)
    const right = slots.at(1)

    if (left.length === 0 || right.length === 0) {
      return
    }

    let comparable = false

    for (const l of left) {
      for (const r of right) {
        if (requireSameOrderableType) {
          const bothNumber = typeof l === 'number' && typeof r === 'number'
          const bothString = typeof l === 'string' && typeof r === 'string'

          if (!bothNumber && !bothString) {
            continue
          }
        }

        comparable = true

        if (compare(l, r)) {
          return [true]
        }
      }
    }

    if (!comparable) {
      return
    }

    return [false]
  }
}

// EQ/NE bypass the nested cross product: O(N+M) using a Set instead of O(N*M).
function opEq (slots) {
  const left = slots.at(0)
  const right = slots.at(1)

  if (left.length === 0 || right.length === 0) {
    return
  }

  const rightSet = new Set(right)

  for (const l of left) {
    if (rightSet.has(l)) {
      return [true]
    }
  }

  return [false]
}

function opNe (slots) {
  const left = slots.at(0)
  const right = slots.at(1)

  if (left.length === 0 || right.length === 0) {
    return
  }

  const rightSet = new Set(right)

  for (const l of left) {
    if (!rightSet.has(l)) {
      return [true]
    }
  }

  return [false]
}

const opGt = makeBinaryComparison((l, r) => l > r, true)
const opGte = makeBinaryComparison((l, r) => l >= r, true)
const opLt = makeBinaryComparison((l, r) => l < r, true)
const opLte = makeBinaryComparison((l, r) => l <= r, true)

// Per-value unary: absolute value of every number in the slot.
function opAbs (slots) {
  const slot = slots.at(0)

  if (slot.length === 0) {
    return
  }

  if (slot.some((v) => typeof v !== 'number')) {
    return
  }

  return slot.map((v) => Math.abs(v))
}

// Per-value binary: round every number in the value slot to N decimals.
function opRound (slots) {
  const value = slots.at(0)
  const decimals = slots.at(1)

  if (value.length === 0 || decimals.length !== 1) {
    return
  }

  const d = decimals.at(0)

  // `toFixed` requires an integer in [0, 100]; anything outside throws RangeError.
  if (typeof d !== 'number' || !Number.isFinite(d) || d < 0 || d > 100 || !Number.isInteger(d)) {
    return
  }

  if (value.some((v) => typeof v !== 'number')) {
    return
  }

  return value.map((v) => Number(v.toFixed(d)))
}

// Unary: true if the input slot is non-empty.
function opExists (slots) {
  return [slots.at(0).length >= 1]
}

// Ternary conditional with else.
function opIf (slots) {
  const cond = slots.at(0)
  const thenSlot = slots.at(1)
  const elseSlot = slots.at(2)

  if (cond.length !== 1 || typeof cond.at(0) !== 'boolean') {
    return
  }

  const chosen = cond.at(0) ? thenSlot : elseSlot

  if (chosen.length === 0) {
    return
  }

  return chosen
}

// Binary conditional without else — returns undefined when cond is false.
function opWhen (slots) {
  const cond = slots.at(0)
  const thenSlot = slots.at(1)

  if (cond.length !== 1 || typeof cond.at(0) !== 'boolean') {
    return
  }

  if (!cond.at(0)) {
    return
  }

  if (thenSlot.length === 0) {
    return
  }

  return thenSlot
}

// ---------------------------------------------------------------------------
// Operator registry
// ---------------------------------------------------------------------------

const OPERATORS = {
  // Variadic reducers — consume the whole stack
  CONCAT: { arity: 'all', fn: opConcat },
  CONCAT_WS: { arity: 'all', fn: opConcatWs },
  SUM: { arity: 'all', fn: opSum },
  SUBTRACT: { arity: 'all', fn: opSubtract },
  MULTIPLY: { arity: 'all', fn: opMultiply },
  DIVIDE: { arity: 'all', fn: opDivide },
  COUNT: { arity: 'all', fn: opCount },
  AVERAGE: { arity: 'all', fn: opAverage },
  MIN: { arity: 'all', fn: opMin },
  MAX: { arity: 'all', fn: opMax },
  IN: { arity: 'all', fn: opIn },
  NIN: { arity: 'all', fn: opNin },

  // Binary comparisons
  EQ: { arity: 2, fn: opEq },
  NE: { arity: 2, fn: opNe },
  GT: { arity: 2, fn: opGt },
  GTE: { arity: 2, fn: opGte },
  LT: { arity: 2, fn: opLt },
  LTE: { arity: 2, fn: opLte },

  // Per-value
  ABS: { arity: 1, fn: opAbs },
  ROUND: { arity: 2, fn: opRound },

  // Other
  EXISTS: { arity: 1, fn: opExists },
  IF: { arity: 3, fn: opIf },
  WHEN: { arity: 2, fn: opWhen }
}

// Safe registry lookup — own properties only, so tokens like `__proto__` or `constructor` don't
// resolve to inherited Object.prototype members.
function lookupOperator (token) {
  if (typeof token !== 'string') {
    return
  }

  if (!Object.hasOwn(OPERATORS, token)) {
    return
  }

  return OPERATORS[token]
}
