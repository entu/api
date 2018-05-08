'use strict'

const _ = require('lodash')
const _h = require('./_helpers')
const { ObjectId } = require('mongodb')

exports.handler = async (event, context) => {
  const user = await _h.user(event)
  if (!user.id) { return _h.error([403, 'Forbidden']) }

  const pId = new ObjectId(event.pathParameters.id)
  const property = await user.db.collection('property').findOne({ _id: pId, deleted: { $exists: false } }, { projection: { _id: false, entity: true, type: true } })

  if (!property) { return _h.error([404, 'Property not found']) }
  if (property.type.substr(0, 1) === '_') { return _h.error([403, 'Can\'t delete system property']) }

  const entity = await user.db.collection('entity').findOne({ _id: property.entity }, { projection: { _id: false, 'private._owner': true, 'private._editor': true } })

  if (!entity) { return _h.error([404, 'Entity not found']) }

  const access = _.map(_.concat(_.get(entity, 'private._owner', []), _.get(entity, 'private._editor', [])), (s) => s.reference.toString())

  if (access.indexOf(user.id) === -1) { return _h.error([403, 'Forbidden']) }

  await user.db.collection('property').updateOne({ _id: pId }, { $set: { deleted: { at: new Date(), by: new ObjectId(user.id) } } })

  await _h.aggregateEntity(user.db, property.entity, property.type)

  return _h.json({ deleted: true })
}
