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
      const e = await db.collection('entity').findOne({ _id: entityId, aggregated: { $gte: new Date(data.dt) } }, { projection: { _id: true } })
      if (!e) {
        console.log('Entity', entityId, 'already aggregated at', data.dt)
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
      aggregated: data.dt ? new Date(data.dt) : new Date()
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

    for (var i = 0; i < referrers.length; i++) {
      await _h.addEntityAggregateSqs(context, data.account, referrers[i]._id.toString(), entity.aggregated)
    }

    console.log('Entity', entityId, 'updated and added', referrers.length, 'entities to sqs')
  }
}
