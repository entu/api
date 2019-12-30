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

    if (data.dt) {
      const e = await db.collection('entity').findOne({ _id: entityId, aggregated: { $gte: new Date(data.dt) } }, { projection: { _id: false, aggregated: true } })
      if (e) {
        console.log('Entity', entityId, 'already aggregated at', e.aggregated)
        continue
      }
    }

    const properties = await db.collection('property').find({ entity: entityId, deleted: { $exists: false } }).toArray()

    if (properties.find(x => x.type === '_deleted')) {
      const deleteResponse = await db.collection('entity').deleteOne({ _id: entityId })
      console.log('Entity', entityId, 'deleted')
      continue
    }

    let entity = {
      aggregated: new Date()
    }

    for (var n = 0; n < properties.length; n++) {
      const prop = properties[n]
      let cleanProp = _.omit(prop, ['entity', 'type', 'created', 'search', 'public'])

      if (prop.reference && ['_viewer', '_expander', '_editor', '_owner'].includes(prop.type)) {
        if (!_.has(entity, 'access')) {
          _.set(entity, 'access', [])
        }
        entity.access.push(prop.reference)
      }

      if (!_.has(entity, ['private', prop.type])) {
        _.set(entity, ['private', prop.type], [])
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
          cleanProp = { ...cleanProp, string: prop.reference }
        }
      }

      if (prop.formula) {
        const formulaResult = await formula(prop.formula, entityId, db)
        cleanProp = {...cleanProp, ...formulaResult}
      }

      if (!Array.isArray(cleanProp)) {
        cleanProp = [cleanProp]
      }
      entity.private[prop.type] = [...entity.private[prop.type], ...cleanProp]

      if (prop.public) {
        if (!_.has(entity, ['public', prop.type])) {
          _.set(entity, ['public', prop.type], [])
        }

        entity.public[prop.type] = [...entity.public[prop.type], ...cleanProp]
      }
    }

    const replaceResponse = await db.collection('entity').replaceOne({ _id: entityId }, entity)

    const referrers = await db.collection('property').aggregate([
      { $match: { reference: entityId, deleted: { $exists: false } } },
      { $group: { _id: '$entity' } }
    ]).toArray()

    const dt = data.dt ? new Date(data.dt) : entity.aggregated

    for (var i = 0; i < referrers.length; i++) {
      await _h.addEntityAggregateSqs(context, data.account, referrers[i]._id.toString(), dt)
    }

    console.log('Entity', entityId, 'updated and added', referrers.length, 'entities to SQS')
  }
}


const formula = async (str, entityId, db) => {
  let func = formulaFunction(str)
  let data = formulaContent(str)

  if (!['CONCAT', 'COUNT', 'SUM', 'AVG'].includes(func)) {
    return { string: str }
  }

  if (data.includes('(') || data.includes(')')) {
    const f = await formula(data)
    data = f.string || f.integer || f.decimal || ''
  }

  if (func === null) {
    return { string: data }
  }

  const dataArray = data.split(',')
  let valueArray = []

  for (let i = 0; i < dataArray.length; i++) {
    const value = await formulaField(dataArray[i], entityId, db)
    if (value !== null) {
      valueArray.push(value)
    }
  }

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
      return { decimal: valueArray.reduce((a, b) => a - b, 0) + (a[0] * 2) }
      break
    case 'AVERAGE':
      return { decimal: valueArray.reduce((a, b) => a + b, 0) / arr.length }
      break
    case 'MIN':
      return { decimal: Math.min(valueArray) }
      break
    case 'MAX':
      return { decimal: Math.max(valueArray) }
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
    return str.substring(1, str.length - 1)
  }

  let result

  switch (str.split('.').length) {
    case 1:
      const config = _.set({}, ['projection', `private.${str}.string`], true)
      const e = await db.collection('entity').findOne({ _id: entityId }, config)
      result = _.get(e, ['private', str, 0, 'string'], '')
      break
    default:
      result = null
  }

  return result
}
