'use strict'

const _isEqual = require('lodash/isequal')
const _sortBy = require('lodash/sortby')
const _omit = require('lodash/omit')
const _h = require('../_helpers')

exports.handler = async (event, context) => {
  if (event.source === 'aws.events') { return _h.json({ message: 'OK' }) }

  if (!event.Records && event.Records.length === 0) { return }

  for (let i = 0; i < event.Records.length; i++) {
    const data = JSON.parse(event.Records[i].body)
    const entityId = _h.strToId(data.entity)
    const db = await _h.db(data.account)

    const entity = await db.collection('entity').findOne({ _id: entityId }, { projection: { _id: false, aggregated: true, 'private.name': true } })

    if (entity && entity.aggregated && data.dt && entity.aggregated >= new Date(data.dt)) {
      console.log('Entity', entityId, '@', data.account, 'already aggregated at', entity.aggregated)
      continue
    }

    const properties = await db.collection('property').find({ entity: entityId, deleted: { $exists: false } }).toArray()

    if (properties.find(x => x.type === '_deleted')) {
      await db.collection('entity').deleteOne({ _id: entityId })
      console.log('Entity', entityId, '@', data.account, 'deleted')
      continue
    }

    const newEntity = {
      aggregated: new Date()
    }

    for (let n = 0; n < properties.length; n++) {
      const prop = properties[n]
      let cleanProp = _omit(prop, ['entity', 'type', 'created', 'search', 'public'])

      if (prop.reference && ['_viewer', '_expander', '_editor', '_owner'].includes(prop.type)) {
        if (!newEntity.access) {
          newEntity.access = []
        }
        newEntity.access.push(prop.reference)
      }

      if (prop.type === '_public' && prop.boolean === true) {
        if (!newEntity.access) {
          newEntity.access = []
        }
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
        const referenceEntities = await db.collection('entity').findOne({ _id: prop.reference }, { projection: { 'private.name': true } })

        if (referenceEntities.private?.name) {
          cleanProp = referenceEntities.private.name.map(x => {
            return { ...cleanProp, ...x }
          })
        } else {
          cleanProp = { ...cleanProp, string: prop.reference.toString() }
        }
      }

      if (!Array.isArray(cleanProp)) {
        cleanProp = [cleanProp]
      }
      newEntity.private[prop.type] = [...newEntity.private[prop.type], ...cleanProp]
    }

    if (newEntity.private._type) {
      const definition = await db.collection('entity').aggregate([
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
          newEntity.private[definition[d].name] = [await formula(definition[d].formula, entityId, db)]
        }

        const dValue = newEntity.private[definition[d].name]

        if (definition[d].search && dValue) {
          if (!newEntity.search) {
            newEntity.search = {}
          }

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
      console.log('NO_TYPE', entityId)
    }

    await db.collection('entity').replaceOne({ _id: entityId }, newEntity, { upsert: true })

    const name = (entity.private?.name || []).map(x => x.string || '')
    const newName = (newEntity.private?.name || []).map(x => x.string || '')

    if (!_isEqual(_sortBy(name), _sortBy(newName))) {
      const referrers = await db.collection('property').aggregate([
        { $match: { reference: entityId, deleted: { $exists: false } } },
        { $group: { _id: '$entity' } }
      ]).toArray()

      const dt = data.dt ? new Date(data.dt) : newEntity.aggregated

      for (let j = 0; j < referrers.length; j++) {
        await _h.addEntityAggregateSqs(context, data.account, referrers[j]._id.toString(), dt)
      }

      console.log('Entity', entityId, '@', data.account, 'updated and added', referrers.length, 'entities to SQS')
    } else {
      console.log('Entity', entityId, '@', data.account, 'updated')
    }
  }
}

const formula = async (str, entityId, db) => {
  const func = formulaFunction(str)
  const data = formulaContent(str)

  if (func && !['CONCAT', 'COUNT', 'SUM', 'SUBTRACT', 'AVERAGE', 'MIN', 'MAX'].includes(func)) {
    return { string: str }
  }

  const dataArray = data.split(',')
  let valueArray = []

  for (let i = 0; i < dataArray.length; i++) {
    const value = await formulaField(dataArray[i], entityId, db)

    if (value) {
      valueArray = [...valueArray, ...value]
    }
  }

  valueArray = getValueArray(valueArray)

  switch (func) {
    case 'CONCAT':
      return { string: valueArray.join('') }
    case 'COUNT':
      return { integer: valueArray.length }
    case 'SUM':
      return { decimal: valueArray.reduce((a, b) => a + b, 0) }
    case 'SUBTRACT':
      return { decimal: valueArray.reduce((a, b) => a - b, 0) + (valueArray[0] * 2) }
    case 'AVERAGE':
      return { decimal: valueArray.reduce((a, b) => a + b, 0) / valueArray.length }
    case 'MIN':
      return { decimal: Math.min(...valueArray) }
    case 'MAX':
      return { decimal: Math.max(...valueArray) }
    default:
      return { string: valueArray.join('') }
  }
}

const formulaFunction = (str) => {
  str = str.trim()

  if (!str.includes('(') || !str.includes(')')) {
    return null
  } else {
    return str.substring(0, str.indexOf('(')).toUpperCase()
  }
}

const formulaContent = (str) => {
  str = str.trim()

  if (!str.includes('(') || !str.includes(')')) {
    return str
  } else {
    return str.substring(str.indexOf('(') + 1, str.lastIndexOf(')'))
  }
}

const formulaField = async (str, entityId, db) => {
  str = str.trim()

  if ((str.startsWith("'") || str.startsWith('"')) && (str.endsWith("'") || str.endsWith('"'))) {
    return [{
      string: str.substring(1, str.length - 1)
    }]
  }

  if (parseFloat(str).toString() === str) {
    return [{
      decimal: parseFloat(str)
    }]
  }

  const strParts = str.split('.')

  const [fieldRef, fieldType, fieldProperty] = str.split('.')

  let result

  // same entity _id
  if (strParts.length === 1 && str === '_id') {
    result = [{ _id: entityId }]

  // same entity property
  } else if (strParts.length === 1 && str !== '_id') {
    result = await db.collection('property').find({
      entity: entityId,
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
      'private._parent.reference': entityId
    }, {
      projection: { _id: true }
    }).toArray()

  // childs (with type) property
  } else if (strParts.length === 3 && fieldRef === '_child' && fieldType !== '*' && fieldProperty === '_id') {
    result = await db.collection('entity').find({
      'private._parent.reference': entityId,
      'private._type.string': fieldType
    }, {
      projection: { _id: true }
    }).toArray()

  // childs property
  } else if (strParts.length === 3 && fieldRef === '_child' && fieldType === '*' && fieldProperty !== '_id') {
    result = await db.collection('entity').aggregate([
      {
        $match: { 'private._parent.reference': entityId }
      }, {
        $lookup: {
          from: 'property',
          let: { entityId: '$_id' },
          pipeline: [
            {
              $match: {
                type: fieldProperty,
                deleted: { $exists: false },
                $expr: { $eq: ['$entity', '$$entityId'] }
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
          'private._parent.reference': entityId,
          'private._type.string': fieldType
        }
      }, {
        $lookup: {
          from: 'property',
          let: { entityId: '$_id' },
          pipeline: [
            {
              $match: {
                type: fieldProperty,
                deleted: { $exists: false },
                $expr: { $eq: ['$entity', '$$entityId'] }
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
          entity: entityId,
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
          entity: entityId,
          type: '_parent',
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
          entity: entityId,
          type: '_parent',
          reference: { $exists: true },
          deleted: { $exists: false }
        }
      }, {
        $lookup: {
          from: 'property',
          let: { entityId: '$reference' },
          pipeline: [
            {
              $match: {
                type: fieldProperty,
                deleted: { $exists: false },
                $expr: { $eq: ['$entity', '$$entityId'] }
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
          entity: entityId,
          type: '_parent',
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
            }, {
              $project: { _id: true }
            }
          ],
          as: 'parents'
        }
      }, {
        $lookup: {
          from: 'property',
          let: { entityId: '$parents._id' },
          pipeline: [
            {
              $match: {
                type: fieldProperty,
                deleted: { $exists: false },
                $expr: { $in: ['$entity', '$$entityId'] }
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

const getValueArray = (values) => {
  if (!values) { return [] }

  return values.map(x => x.decimal || x.integer || x.datetime || x.date || x.string || x._id)
}
