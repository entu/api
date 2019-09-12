'use strict'

const _ = require('lodash')
const _h = require('../_helpers')

exports.handler = async (event, context) => {
  if (event.source === 'aws.events') { return }

  try {
    const user = await _h.user(event)
    let property = await user.db.collection('property').findOne({ _id: _h.strToId(event.pathParameters.id), deleted: { $exists: false } })

    if (!property) { return _h.error([404, 'Property not found']) }

    const entity = await user.db.collection('entity').findOne({ _id: property.entity }, { projection: { _id: false, access: true } })

    if (!entity) { return _h.error([404, 'Entity not found']) }

    const access = _.get(entity, 'access', []).map((s) => s.toString())

    if (property.public) {
      if (!access.includes('public')) { return _h.error([403, 'Not a public property']) }
    } else {
      if (!access.includes(user.id)) { return _h.error([403, 'User not in any rights property']) }
    }

    if (property.s3) {
      property.url = await _h.getSignedUrl(property.s3)

      _.unset(property, 's3')
    }

    if (property.type === 'entu_api_key') {
      property.string = '***'
    }

    if (_.get(property, 'url') && _.has(event, 'queryStringParameters.download')) {
      return _h.redirect(_.get(property, 'url'))
    } else {
      return _h.json(property)
    }
  } catch (e) {
    return _h.error(e)
  }
}
