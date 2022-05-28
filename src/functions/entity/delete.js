'use strict'

const _h = require('../_helpers')

exports.handler = async (event, context) => {
  if (event.source === 'aws.events') { return _h.json({ message: 'OK' }) }

  try {
    const user = await _h.user(event)
    if (!user.id) { return _h.error([403, 'No user']) }

    const eId = _h.strToId(event.pathParameters.id)
    const entity = await user.db.collection('entity').findOne({
      _id: eId
    }, {
      projection: {
        _id: false,
        'private._owner': true
      }
    })
    if (!entity) { return _h.error([404, 'Entity not found']) }

    const access = (entity.private?._owner || []).map((s) => s.reference.toString())

    if (!access.includes(user.id)) { return _h.error([403, 'User not in _owner property']) }

    await user.db.collection('property').insertOne({
      entity: eId,
      type: '_deleted',
      reference: _h.strToId(user.id),
      datetime: new Date(),
      created: {
        at: new Date(),
        by: _h.strToId(user.id)
      }
    })
    await _h.addEntityAggregateSqs(context, user.account, eId)

    const properties = await user.db.collection('property').find({
      reference: eId,
      deleted: { $exists: false }
    }, {
      projection: {
        entity: true,
        type: true
      }
    }).toArray()

    for (let i = 0; i < properties.length; i++) {
      const property = properties[i]

      await user.db.collection('property').updateOne({
        _id: property._id
      }, {
        $set: {
          deleted: {
            at: new Date(),
            by: _h.strToId(user.id)
          }
        }
      })
      await _h.addEntityAggregateSqs(context, user.account, property.entity)
    }

    return _h.json({ deleted: true })
  } catch (e) {
    return _h.error(e)
  }
}
