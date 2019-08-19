'use strict'

const _ = require('lodash')
const _h = require('../_helpers')
const { ObjectId } = require('mongodb')

exports.handler = async (event, context) => {
  if (event.source === 'aws.events') { return }

  try {
    const user = await _h.user(event)

    const props = _.compact(_.get(event, 'queryStringParameters.props', '').split(','))
    let config = {}

    if (props.length > 0) {
      _.forEach(props, (f) => {
        if (f === '_thumbnail') {
          _.set(config, ['projection', `private.photo.s3`], true)
          _.set(config, ['projection', `public.photo.s3`], true)
        } else {
          _.set(config, ['projection', `private.${f}`], true)
          _.set(config, ['projection', `public.${f}`], true)
        }
      })
      _.set(config, 'projection.access', true)
    }

    const entity = await user.db.collection('entity').findOne({ _id: new ObjectId(event.pathParameters.id) }, config)
    if (!entity) { return _h.error([404, 'Entity not found']) }

    const result = await _h.claenupEntity(entity, user)

    if (!result) {
      return _h.error([403, 'Forbidden. No accessible properties.'])
    }

    return _h.json(await _h.claenupEntity(entity, user))
  } catch (e) {
    return _h.error(e)
  }
}
