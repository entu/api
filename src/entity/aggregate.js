'use strict'

const _ = require('lodash')
const _h = require('../_helpers')

exports.handler = async (event, context) => {
  if (event.source === 'aws.events') { return _h.json({ message: 'OK' }) }

  if (!event.Records && event.Records.length === 0) { return }

  for (var i = 0; i < event.Records.length; i++) {
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
      const deleteResponse = await db.collection('entity').deleteOne({ _id: entityId })
      console.log('Entity', entityId, '@', data.account, 'deleted')
      continue
    }

    let newEntity = {
      aggregated: new Date()
    }

    for (var n = 0; n < properties.length; n++) {
      const prop = properties[n]
      let cleanProp = _.omit(prop, ['entity', 'type', 'created', 'search', 'public'])

      if (prop.reference && ['_viewer', '_expander', '_editor', '_owner'].includes(prop.type)) {
        if (!_.has(newEntity, 'access')) {
          _.set(newEntity, 'access', [])
        }
        newEntity.access.push(prop.reference)
      }

      if (prop.type === '_public' && prop.boolean === true) {
        if (!_.has(newEntity, 'access')) {
          _.set(newEntity, 'access', [])
        }
        newEntity.access.push('public')
      }

      if (!_.has(newEntity, ['private', prop.type])) {
        _.set(newEntity, ['private', prop.type], [])
      }

      if (prop.date) {
        const d = new Date(prop.date)
        cleanProp = { ...cleanProp, string: d.toISOString().substring(0, 9) }
      }

      if (prop.reference) {
        const referenceEntities = await db.collection('entity').findOne({ _id: prop.reference }, { projection: { 'private.name': true }})

        if (_.has(referenceEntities, 'private.name')) {
          cleanProp = referenceEntities.private.name.map(x => {
            return { ...cleanProp, ...x }
          })
        } else {
          cleanProp = { ...cleanProp, string: prop.reference.toString() }
        }
      }

      if (prop.formula) {
        const formulaResult = await formula(prop.formula, entityId, db)
        cleanProp = {...cleanProp, ...formulaResult}
      }

      if (!Array.isArray(cleanProp)) {
        cleanProp = [cleanProp]
      }
      newEntity.private[prop.type] = [...newEntity.private[prop.type], ...cleanProp]

      if (prop.public) {
        if (!_.has(newEntity, ['public', prop.type])) {
          _.set(newEntity, ['public', prop.type], [])
        }

        newEntity.public[prop.type] = [...newEntity.public[prop.type], ...cleanProp]
      }
    }

    const replaceResponse = await db.collection('entity').replaceOne({ _id: entityId }, newEntity)

    const name = _.get(entity, 'private.name', []).map(x => x.string || '')
    const newName = _.get(newEntity, 'private.name', []).map(x => x.string || '')

    if (!_.isEqual(_.sortBy(name), _.sortBy(newName))) {
      const referrers = await db.collection('property').aggregate([
        { $match: { reference: entityId, deleted: { $exists: false } } },
        { $group: { _id: '$entity' } }
      ]).toArray()

      const dt = data.dt ? new Date(data.dt) : newEntity.aggregated

      for (var i = 0; i < referrers.length; i++) {
        await _h.addEntityAggregateSqs(context, data.account, referrers[i]._id.toString(), dt)
      }

      console.log('Entity', entityId, '@', data.account, 'updated and added', referrers.length, 'entities to SQS')
    } else {
      console.log('Entity', entityId, '@', data.account, 'updated')
    }
  }
}


const formula = async (str, entityId, db) => {
  let func = formulaFunction(str)
  let data = formulaContent(str)

  if (!['CONCAT', 'COUNT', 'SUM', 'SUBTRACT', 'AVERAGE', 'MIN', 'MAX'].includes(func)) {
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

  valueArray = formulaValue(valueArray)

  switch (func) {
    case 'CONCAT':
      return { string: valueArray.join('') }
      break
    case 'COUNT':
      return { integer: valueArray.length }
      break
    case 'SUM':
      return { decimal: valueArray.reduce((a, b) => a + b, 0) }
      break
    case 'SUBTRACT':
      return { decimal: valueArray.reduce((a, b) => a - b, 0) + (valueArray[0] * 2) }
      break
    case 'AVERAGE':
      return { decimal: valueArray.reduce((a, b) => a + b, 0) / valueArray.length }
      break
    case 'MIN':
      return { decimal: Math.min(...valueArray) }
      break
    case 'MAX':
      return { decimal: Math.max(...valueArray) }
      break
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

  const [ref, type, property] = str.split('.')

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
  } else if (strParts.length === 3 && strParts[0] === 'child' && strParts[2] === '_id') {
    const config = {
      'private._parent.reference': entityId,
    }

    if (strParts[1] !== '*') {
      _.set(config, ['private._type.string'], strParts[1])
    }

    result = await db.collection('entity').find(config, {
      projection: { _id: true }
    }).toArray()

  // childs property
  } else if (strParts.length === 3 && strParts[0] === 'child' && strParts[2] !== '_id') {
    const config = [
      {
        $match : { 'private._parent.reference': entityId }
      }, {
        $project: { _id: true }
      }, {
        $lookup: {
          from: 'property',
          let: { entityId: '$_id' },
          pipeline: [
            {
              $match: {
                type: strParts[2],
                deleted: { $exists: false },
                $expr: { $eq: [ '$entity',  '$$entityId' ] }
              }
            }, {
              $project: { _id: false, entity: false, type: false, created: false }
            }
          ],
          as: 'properties'
        }
      }, {
        $project: { _id: false }
      }
    ]

    if (strParts[1] !== '*') {
      _.set(config, [0, '$match', 'private._type.string'], strParts[1])
    }

    const p = await db.collection('entity').aggregate(config).toArray()

    result = p.map(x => x.properties).flat()

  // parents _id
  } else if (strParts.length === 3 && strParts[0] === 'parent' && strParts[2] === '_id') {
    const config = [
      {
        $match : {
          entity: entityId,
          type: '_parent',
          reference: { $exists: true },
          deleted: { $exists: false }
        }
      }, {
        $project: { _id: false, _id: '$reference' }
      }
    ]

    if (strParts[1] !== '*') {
      config.push({
        $lookup: {
          from: 'entity',
          let: { entityId: '$_id' },
          pipeline: [
            {
              $match: {
                'private._type.string': strParts[1],
                $expr: { $eq: [ '$_id',  '$$entityId' ] }
              }
            }, {
              $project: { _id: true }
            }
          ],
          as: 'parents'
        }
      })
      config.push({
        $project: { _id: false }
      })
    }

    const p = await db.collection('property').aggregate(config).toArray()

    result = p.map(x => x.parents).flat()

  }

  return result
}

const formulaValue = (values) => {
  if (!values) { return [] }

  return values.map(x => x.decimal || x.integer || x.datetime || x.date || x.string || x._id)
}
