'use strict'

const _ = require('lodash')
const _h = require('./_helpers')
const { ObjectId } = require('mongodb')

exports.handler = async (event, context) => {
  const user = await _h.user(event)
  const props = _.compact(_.get(event, 'queryStringParameters.props', '').split(','))
  const sort = _.compact(_.get(event, 'queryStringParameters.sort', '').split(','))
  var filter = {}
  var fields = {}
  var sortFields = {}
  var limit = _.toSafeInteger(_.get(event, 'queryStringParameters.limit')) || 100
  var skip = _.toSafeInteger(_.get(event, 'queryStringParameters.skip')) || 0

  _.forIn(_.get(event, 'queryStringParameters'), (v, k) => {
    if (k.indexOf('.') !== -1) {
      const fieldArray = k.split('.')
      let field = _.get(fieldArray, 0)
      let type = _.get(fieldArray, 1)
      let operator = _.get(fieldArray, 2)
      let value

      switch (type) {
        case 'reference':
          value = new ObjectId(v)
          break
        case 'boolean':
          value = v.toLowerCase() === 'true'
          break
        case 'integer':
          value = _.toNumber(v)
          break
        case 'size':
          value = _.toNumber(v)
          break
        case 'decimal':
          value = _.toNumber(v)
          break
        case 'date':
          value = new Date(v)
          break
        case 'datetime':
          value = new Date(v)
          break
        default:
          if (operator === 'regex' && v.indexOf('/') > -1) {
            value = new RegExp(v.split('/')[1], v.split('/')[2])
          } else if (operator === 'exists') {
            value = v.toLowerCase() === 'true'
          } else {
            value = v
          }
      }

      if (['gt', 'gte', 'lt', 'lte', 'ne', 'regex', 'exists'].indexOf(operator) !== -1) {
        _.set(filter, [`private.${field}.${type}`, `$${operator}`], value)
      } else {
        filter[`private.${field}.${type}`] = value
      }
    }
  })

  if (user.id) {
    filter.access = { '$in': [new ObjectId(user.id), 'public'] }
  } else {
    filter.access = 'public'
  }

  if (props.length > 0) {
    _.forEach(props, (f) => {
      fields[`private.${f}`] = true
      fields[`public.${f}`] = true
    })
    fields['access'] = true
  }

  if (sort.length > 0) {
    _.forEach(sort, (f) => {
      if (f.substr(0, 1) === '-') {
        sortFields[`private.${f.substr(1)}`] = -1
      } else {
        sortFields[`private.${f}`] = 1
      }
    })
  } else {
    sortFields = { _id: 1 }
  }

  const findedEntities = await user.db.collection('entity').find(filter, { projection: fields })
  const count = await findedEntities.count()
  const entities = await findedEntities.sort(sortFields).skip(skip).limit(limit).toArray()

  return _h.json({
    count: count,
    entities: _.map(entities, (entity) => {
      const access = _.map(_.get(entity, 'access', []), (s) => {
        return s.toString()
      })

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

      if (user.id && access.indexOf(user.id) !== -1) {
        return Object.assign({ _id: entity._id }, _.get(entity, 'private', {}))
      } else if (access.indexOf('public') !== -1) {
        return Object.assign({ _id: entity._id }, _.get(entity, 'public', {}))
      } else {
        return { _id: entity._id }
      }
    })
  })
}
