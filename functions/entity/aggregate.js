'use strict'

const _ = require('lodash')
const _h = require('helpers')

exports.handler = async (event, context) => {
  if (event.source === 'aws.events') return _h.json({ message: 'OK' })

  const user = await _h.user(event)
  const eId = event.pathParameters?._id ? _h.strToId(event.pathParameters._id) : null
  const date = event.queryStringParameters?.date

  const entity = await user.db.collection('entity').findOne({ _id: eId }, { projection: { _id: false, aggregated: true, 'private.name': true } })

  if (!entity) return _h.error([404, 'Entity not found'])

  if (entity && entity.aggregated && date && entity.aggregated >= new Date(date)) {
    console.log(`SKIP ${eId.toString()}`)
    return {
      account: user.account,
      entity: eId,
      ignored: true,
      message: `Entity is already aggregated at ${entity.aggregated.toISOString()}`
    }
  }

  const properties = await user.db.collection('property').find({ entity: eId, deleted: { $exists: false } }).toArray()

  if (properties.find(x => x.type === '_deleted')) {
    await user.db.collection('entity').deleteOne({ _id: eId })

    console.log(`DELETED ${eId.toString()}`)
    return {
      account: user.account,
      entity: eId,
      deleted: true,
      message: 'Entity is deleted'
    }
  }

  const newEntity = {
    aggregated: new Date(),
    private: {},
    public: {},
    access: [],
    references: [],
    search: {}
  }

  for (let n = 0; n < properties.length; n++) {
    const prop = properties[n]
    let cleanProp = _.omit(prop, ['entity', 'type', 'created', 'search', 'public'])

    if (prop.reference && ['_viewer', '_expander', '_editor', '_owner'].includes(prop.type)) {
      newEntity.access.push(prop.reference)
    }

    if (prop.type === '_public' && prop.boolean === true) {
      newEntity.access.push('public')
    }

    if (!newEntity.private[prop.type]) {
      newEntity.private[prop.type] = []
    }

    if (prop.date) {
      const d = new Date(prop.date)
      cleanProp = { ...cleanProp, string: d.toISOString().substring(0, 9) }
    }

    if (prop.reference) {
      const referenceEntity = await user.db.collection('entity').findOne({ _id: prop.reference }, { projection: { 'private.name': true, 'private.type': true } })

      if (referenceEntity?.private?.name) {
        cleanProp = referenceEntity.private.name.map(x => ({ ...cleanProp, ...x }))
      } else {
        cleanProp = { ...cleanProp, string: prop.reference.toString() }
      }

      if (!Array.isArray(cleanProp)) {
        cleanProp = [cleanProp]
      }

      const refProps = cleanProp.map(x => ({ ...x, entityType: referenceEntity?.private?.type }))
      newEntity.references = [...newEntity.references, ...refProps]
    }

    if (!Array.isArray(cleanProp)) {
      cleanProp = [cleanProp]
    }

    newEntity.private[prop.type] = [...newEntity.private[prop.type], ...cleanProp]
  }

  if (newEntity.private._type) {
    const definition = await user.db.collection('entity').aggregate([
      {
        $match: {
          'private._parent.reference': newEntity.private._type[0].reference,
          'private._type.string': 'property',
          'private.name.string': { $exists: true }
        }
      }, {
        $project: {
          _id: false,
          name: { $arrayElemAt: ['$private.name.string', 0] },
          public: { $arrayElemAt: ['$private.public.boolean', 0] },
          search: { $arrayElemAt: ['$private.search.boolean', 0] },
          formula: { $arrayElemAt: ['$private.formula.string', 0] }
        }
      }
    ]).toArray()

    for (let d = 0; d < definition.length; d++) {
      if (definition[d].formula) {
        newEntity.private[definition[d].name] = [await formula(definition[d].formula, eId, user.db)]
      }

      const dValue = newEntity.private[definition[d].name]

      if (definition[d].search && dValue) {
        newEntity.search.private = [...(newEntity.search.private || []), ...getValueArray(dValue)]

        if (definition[d].public) {
          newEntity.search.public = [...(newEntity.search.public || []), ...getValueArray(dValue)]
        }
      }

      if (definition[d].public && dValue) {
        newEntity.public[definition[d].name] = dValue
      }
    }
  } else {
    console.log(`NO_TYPE ${newEntity.private._type} ${eId.toString()}`)
  }

  if (Object.keys(newEntity.public).length === 0) {
    delete newEntity.public
  }

  await user.db.collection('entity').replaceOne({ _id: eId }, newEntity, { upsert: true })

  const name = (entity.private?.name || []).map(x => x.string || '')
  const newName = (newEntity.private?.name || []).map(x => x.string || '')

  if (_.isEqual(_.sortBy(name), _.sortBy(newName))) {
    console.log(`UPDATED ${eId.toString()}`)
    return {
      _id: eId,
      account: user.account,
      updated: true,
      message: 'Entity updated'
    }
  }

  const referrers = await user.db.collection('property').aggregate([
    { $match: { reference: eId, deleted: { $exists: false } } },
    { $group: { _id: '$entity' } }
  ]).toArray()

  const dt = date ? new Date(date) : newEntity.aggregated

  for (let j = 0; j < referrers.length; j++) {
    await _h.addEntityAggregateSqs(context, user.account, referrers[j]._id.toString(), dt)
  }

  console.log(`UPDATED_SQS ${eId.toString()}`)
  return {
    _id: eId,
    account: user.account,
    updated: true,
    sqsLength: referrers.length,
    message: `Entity updated and added ${referrers.length} entities to SQS`
  }
}

async function formula (str, eId, db) {
  const func = formulaFunction(str)
  const data = formulaContent(str)

  if (func && !['CONCAT', 'COUNT', 'SUM', 'SUBTRACT', 'AVERAGE', 'MIN', 'MAX'].includes(func)) {
    return { string: str }
  }

  const dataArray = data.split(',')
  let valueArray = []

  for (let i = 0; i < dataArray.length; i++) {
    const value = await formulaField(dataArray[i], eId, db)

    if (value) {
      valueArray = [...valueArray, ...value]
    }
  }

  valueArray = getValueArray(valueArray)

  switch (func) {
    case 'CONCAT':
      return { string: valueArray.join('') }
    case 'COUNT':
      return { number: valueArray.length }
    case 'SUM':
      return { number: valueArray.reduce((a, b) => a + b, 0) }
    case 'SUBTRACT':
      return { number: valueArray.reduce((a, b) => a - b, 0) + (valueArray[0] * 2) }
    case 'AVERAGE':
      return { number: valueArray.reduce((a, b) => a + b, 0) / valueArray.length }
    case 'MIN':
      return { number: Math.min(...valueArray) }
    case 'MAX':
      return { number: Math.max(...valueArray) }
    default:
      return { string: valueArray.join('') }
  }
}

async function formulaField (str, eId, db) {
  str = str.trim()

  if ((str.startsWith("'") || str.startsWith('"')) && (str.endsWith("'") || str.endsWith('"'))) {
    return [{
      string: str.substring(1, str.length - 1)
    }]
  }

  if (parseFloat(str).toString() === str) {
    return [{
      number: parseFloat(str)
    }]
  }

  const strParts = str.split('.')

  const [fieldRef, fieldType, fieldProperty] = str.split('.')

  let result

  // same entity _id
  if (strParts.length === 1 && str === '_id') {
    result = [{ _id: eId }]

  // same entity property
  } else if (strParts.length === 1 && str !== '_id') {
    result = await db.collection('property').find({
      entity: eId,
      type: str,
      string: { $exists: true },
      deleted: { $exists: false }
    }, {
      sort: { _id: 1 },
      projection: { _id: false, entity: false, type: false }
    }).toArray()

  // childs _id
  } else if (strParts.length === 3 && fieldRef === '_child' && fieldType === '*' && fieldProperty === '_id') {
    result = await db.collection('entity').find({
      'private._parent.reference': eId
    }, {
      projection: { _id: true }
    }).toArray()

  // childs (with type) property
  } else if (strParts.length === 3 && fieldRef === '_child' && fieldType !== '*' && fieldProperty === '_id') {
    result = await db.collection('entity').find({
      'private._parent.reference': eId,
      'private._type.string': fieldType
    }, {
      projection: { _id: true }
    }).toArray()

  // childs property
  } else if (strParts.length === 3 && fieldRef === '_child' && fieldType === '*' && fieldProperty !== '_id') {
    result = await db.collection('entity').aggregate([
      {
        $match: { 'private._parent.reference': eId }
      }, {
        $lookup: {
          from: 'property',
          let: { eId: '$_id' },
          pipeline: [
            {
              $match: {
                type: fieldProperty,
                deleted: { $exists: false },
                $expr: { $eq: ['$entity', '$$eId'] }
              }
            }, {
              $project: { _id: false, entity: false, type: false, created: false }
            }
          ],
          as: 'properties'
        }
      }, {
        $project: { properties: true }
      }, {
        $unwind: '$properties'
      }, {
        $replaceWith: '$properties'
      }
    ]).toArray()

  // childs (with type) property
  } else if (strParts.length === 3 && fieldRef === '_child' && fieldType !== '*' && fieldProperty !== '_id') {
    result = await db.collection('entity').aggregate([
      {
        $match: {
          'private._parent.reference': eId,
          'private._type.string': fieldType
        }
      }, {
        $lookup: {
          from: 'property',
          let: { eId: '$_id' },
          pipeline: [
            {
              $match: {
                type: fieldProperty,
                deleted: { $exists: false },
                $expr: { $eq: ['$entity', '$$eId'] }
              }
            }, {
              $project: { _id: false, entity: false, type: false, created: false }
            }
          ],
          as: 'properties'
        }
      }, {
        $project: { properties: true }
      }, {
        $unwind: '$properties'
      }, {
        $replaceWith: '$properties'
      }
    ]).toArray()

  // parents _id
  } else if (strParts.length === 3 && fieldRef === '_parent' && fieldType === '*' && fieldProperty === '_id') {
    result = await db.collection('property').aggregate([
      {
        $match: {
          entity: eId,
          type: '_parent',
          reference: { $exists: true },
          deleted: { $exists: false }
        }
      }, {
        $project: { _id: '$reference' }
      }
    ]).toArray()

  // parents (with type) _id
  } else if (strParts.length === 3 && fieldRef === '_parent' && fieldType !== '*' && fieldProperty === '_id') {
    result = await db.collection('property').aggregate([
      {
        $match: {
          entity: eId,
          type: '_parent',
          reference: { $exists: true },
          deleted: { $exists: false }
        }
      }, {
        $lookup: {
          from: 'entity',
          let: { eId: '$reference' },
          pipeline: [
            {
              $match: {
                'private._type.string': fieldType,
                $expr: { $eq: ['$_id', '$$eId'] }
              }
            }, {
              $project: { _id: true }
            }
          ],
          as: 'parents'
        }
      }, {
        $unwind: '$parents'
      }, {
        $replaceWith: '$parents'
      }
    ]).toArray()

  // parents property
  } else if (strParts.length === 3 && fieldRef === '_parent' && fieldType === '*' && fieldProperty !== '_id') {
    result = await db.collection('property').aggregate([
      {
        $match: {
          entity: eId,
          type: '_parent',
          reference: { $exists: true },
          deleted: { $exists: false }
        }
      }, {
        $lookup: {
          from: 'property',
          let: { eId: '$reference' },
          pipeline: [
            {
              $match: {
                type: fieldProperty,
                deleted: { $exists: false },
                $expr: { $eq: ['$entity', '$$eId'] }
              }
            }, {
              $project: { _id: false, entity: false, type: false, created: false }
            }
          ],
          as: 'properties'
        }
      }, {
        $project: { properties: true }
      }, {
        $unwind: '$properties'
      }, {
        $replaceWith: '$properties'
      }
    ]).toArray()

  // parents (with type) property
  } else if (strParts.length === 3 && fieldRef === '_parent' && fieldType !== '*' && fieldProperty !== '_id') {
    result = await db.collection('property').aggregate([
      {
        $match: {
          entity: eId,
          type: '_parent',
          reference: { $exists: true },
          deleted: { $exists: false }
        }
      }, {
        $lookup: {
          from: 'entity',
          let: { eId: '$reference' },
          pipeline: [
            {
              $match: {
                'private._type.string': fieldType,
                $expr: { $eq: ['$_id', '$$eId'] }
              }
            }, {
              $project: { _id: true }
            }
          ],
          as: 'parents'
        }
      }, {
        $lookup: {
          from: 'property',
          let: { eId: '$parents._id' },
          pipeline: [
            {
              $match: {
                type: fieldProperty,
                deleted: { $exists: false },
                $expr: { $in: ['$entity', '$$eId'] }
              }
            }, {
              $project: { _id: false, entity: false, type: false, created: false }
            }
          ],
          as: 'properties'
        }
      }, {
        $project: { properties: true }
      }, {
        $unwind: '$properties'
      }, {
        $replaceWith: '$properties'
      }
    ]).toArray()
  }

  return result
}

function formulaFunction (str) {
  str = str.trim()

  if (!str.includes('(') || !str.includes(')')) {
    return null
  } else {
    return str.substring(0, str.indexOf('(')).toUpperCase()
  }
}

function formulaContent (str) {
  str = str.trim()

  if (!str.includes('(') || !str.includes(')')) {
    return str
  } else {
    return str.substring(str.indexOf('(') + 1, str.lastIndexOf(')'))
  }
}

function getValueArray (values) {
  if (!values) return []

  return values.map(x => x.number || x.datetime || x.date || x.string || x._id)
}
