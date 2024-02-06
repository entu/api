'use strict'

const _h = require('helpers')

exports.handler = async (event, context) => {
  if (event.source === 'aws.events') return _h.json({ message: 'OK' })

  try {
    _h.addStats(event, context.functionName)

    const user = await _h.user(event)
    const property = await user.db.collection('property').findOne({
      _id: _h.strToId(event.pathParameters._id),
      deleted: { $exists: false }
    })

    if (!property) return _h.error([404, 'Property not found'])

    const entity = await user.db.collection('entity').findOne({
      _id: property.entity
    }, {
      projection: {
        _id: false,
        access: true
      }
    })

    if (!entity) return _h.error([404, 'Entity not found'])

    const access = (entity.access || []).map((s) => s.toString())

    if (property.public) {
      if (!access.includes('public')) return _h.error([403, 'Not a public property'])
    } else {
      if (!access.includes(user.id)) return _h.error([403, 'User not in any rights property'])
    }

    if (property.s3) {
      property.url = await _h.getSignedDownloadUrl(property.s3)

      delete property.s3
    }

    if (property.type === 'entu_api_key') {
      property.string = '***'
    }

    if (property.url && event.queryStringParameters?.download) {
      return _h.redirect(property.url)
    } else {
      return _h.json(property)
    }
  } catch (e) {
    return _h.error(e)
  }
}
