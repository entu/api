'use strict'

const _ = require('lodash')
const _h = require('./_helpers')
const { ObjectId } = require('mongodb')

exports.handler = async (event, context) => {
  try {
    const user = await _h.user(event)

    const props = _.compact(_.get(event, 'queryStringParameters.props', '').split(','))
    let config = {}

    if (props.length > 0) {
      _.forEach(props, (f) => {
        _.set(config, ['projection', `private.${f}`], true)
      })
      _.set(config, 'projection.access', true)
    }

    const entity = await user.db.collection('entity').findOne({ _id: new ObjectId(event.pathParameters.id) }, config)
    if (!entity) { return _h.error([404, 'Entity not found']) }

    if (_.has(entity, 'private.entu_api_key')) {
      _.get(entity, 'private.entu_api_key', []).forEach((k) => {
        k.string = '***'
      })
    }
    if (_.has(entity, 'public.entu_api_key')) {
      _.get(entity, 'public.entu_api_key', []).forEach((k) => {
        k.string = '***'
      })
    }

    const access = _.map(_.get(entity, 'access', []), (s) => s.toString())

    if (user.id && access.indexOf(user.id) !== -1) {
      return _h.json(Object.assign({ _id: entity._id }, _.get(entity, 'private', {})))
    } else if (access.indexOf('public') !== -1) {
      return _h.json(Object.assign({ _id: entity._id }, _.get(entity, 'public', {})))
    } else {
      return _h.error([403, 'Forbidden'])
    }
  } catch (e) {
    console.error(e)
    return _h.json(e)
  }
}
