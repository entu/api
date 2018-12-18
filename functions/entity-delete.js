'use strict'

const _ = require('lodash')
const _h = require('./_helpers')
const { ObjectId } = require('mongodb')

exports.handler = async (event, context) => {
  if (event.source === 'aws.events') { return }

  try {
    const user = await _h.user(event)
    if (!user.id) { return _h.error([403, 'Forbidden. No user.']) }

    var eId = new ObjectId(event.pathParameters.id)
    const entity = await user.db.collection('entity').findOne({ _id: eId }, { projection: { _id: false, 'private._owner': true } })
    if (!entity) { return _h.error([404, 'Entity not found']) }

    const access = _.map(_.get(entity, 'private._owner', []), (s) => s.reference.toString())

    if (!access.includes(user.id)) { return _h.error([403, 'Forbidden. User not in _owner property.']) }

    await user.db.collection('property').insertOne({ entity: eId, type: '_deleted', reference: new ObjectId(user.id), datetime: new Date(), created: { at: new Date(), by: new ObjectId(user.id) } })
    await _h.addEntityAggregateSqs(context, user.account, eId)

    const properties = await user.db.collection('property').find({ reference: eId, deleted: { $exists: false } }, { projection: { entity: true, type: true } }).toArray()

    for (let i = 0; i < properties.length; i++) {
      const property = properties[i]

      await user.db.collection('property').updateOne({ _id: property._id }, { $set: { deleted: { at: new Date(), by: new ObjectId(user.id) } } })
      await _h.addEntityAggregateSqs(context, user.account, property.entity)
    }

    return _h.json({ deleted: true })
  } catch (e) {
    return _h.error(e)
  }
}
