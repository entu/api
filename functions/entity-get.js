'use strict'

console.log('Loading function')

const _ = require('lodash')
const _h = require('./_helpers')
const async = require('async')
const objectId = require('mongodb').ObjectID



exports.handler = (event, context, callback) => {
  context.callbackWaitsForEmptyEventLoop = false

  _h.user(event, (err, user) => {
    if (err) { return callback(null, _h.error(err)) }

    async.waterfall([
      (callback) => {
        const props = _.compact(_.get(event, 'queryStringParameters.props', '').split(','))
        let config = {}

        if (props.length > 0) {
          _.forEach(props, (f) => {
            _.set(config, ['projection', `private.${f}`], true)
          })
          _.set(config, 'projection.access', true)
        }

        user.db.collection('entity').findOne({ _id: new objectId(event.pathParameters.id) }, config, callback)
      },
    ], (err, entity) => {
      if (err) { return callback(null, _h.error(err)) }

      if (!entity) { return callback(null, _h.error([404, 'Entity not found'])) }

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

      const access = _.map(_.get(entity, 'access', []), (s) => {
        return s.toString()
      })

      if (user.id && access.indexOf(user.id) !== -1) {
        return callback(null, _h.json(Object.assign({ _id: entity._id }, _.get(entity, 'private', {}))))
      } else if (access.indexOf('public') !== -1) {
        return callback(null, _h.json(Object.assign({ _id: entity._id }, _.get(entity, 'public', {}))))
      } else {
        return  callback(null, _h.error([403, 'Forbidden']))
      }
    })
  })
}
