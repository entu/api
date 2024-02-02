'use strict'

const _h = require('helpers')

const rightTypes = [
  '_viewer',
  '_expander',
  '_editor',
  '_owner',
  '_public',
  '_parent'
]

exports.handler = async (event, context) => {
  if (event.source === 'aws.events') return _h.json({ message: 'OK' })

  try {
    const user = await _h.user(event)
    if (!user.id) return _h.error([403, 'No user'])

    const pId = _h.strToId(event.pathParameters._id)
    const property = await user.db.collection('property').findOne({
      _id: pId,
      deleted: { $exists: false }
    }, {
      projection: {
        _id: false,
        entity: true,
        type: true
      }
    })

    if (!property) return _h.error([404, 'Property not found'])
    if (property.type.startsWith('_') && !rightTypes.includes(property.type)) return _h.error([403, 'Can\'t delete system property'])

    const entity = await user.db.collection('entity').findOne({
      _id: property.entity
    }, {
      projection: {
        _id: false,
        'private._editor': true,
        'private._owner': true
      }
    })

    if (!entity) return _h.error([404, 'Entity not found'])

    const access = (entity.private?._editor || []).map((s) => s.reference?.toString())

    if (!access.includes(user.id)) return _h.error([403, 'User not in _owner nor _editor property'])

    const owners = (entity.private?._owner || []).map((s) => s.reference?.toString())

    if (rightTypes.includes(property.type) && !owners.includes(user.id)) return _h.error([403, 'User not in _owner property'])

    await user.db.collection('property').updateOne({
      _id: pId
    }, {
      $set: {
        deleted: {
          at: new Date(),
          by: _h.strToId(user.id)
        }
      }
    })

    await _h.addEntityAggregateSqs(context, user.account, property.entity)

    return _h.json({ deleted: true })
  } catch (e) {
    return _h.error(e)
  }
}
