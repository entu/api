'use strict'

const _ = require('lodash')
const _h = require('../_helpers')

exports.handler = async (event, context) => {
  if (event.source === 'aws.events') { return _h.json({ message: 'OK' }) }

  try {
    const user = await _h.user(event)
    const eId = event.pathParameters && event.pathParameters.id ? _h.strToId(event.pathParameters.id) : null
    const props = _.get(event, 'queryStringParameters.props', '').split(',').filter((x) => !!x)
    var fields = {}
    var result = {}
    var getThumbnail = props.length === 0

    if (props.length > 0) {
      props.forEach((f) => {
        if (f === '_thumbnail') {
          fields[`private.photo.s3`] = true
          fields[`public.photo.s3`] = true
          getThumbnail = true
        } else {
          fields[`private.${f}`] = true
          fields[`public.${f}`] = true
        }
      })
      fields['access'] = true
    }

    if (eId) {
      const entity = await user.db.collection('entity').findOne({ _id: eId }, { projection: fields })
      if (!entity) { return _h.error([404, 'Entity not found']) }

      const cleanedEntity = await claenupEntity(entity, user, getThumbnail)

      if (!cleanedEntity) { return _h.error([403, 'No accessible properties']) }

      result = {
        filter: { _id: eId },
        props: props,
        entity: cleanedEntity
      }
    } else {
      const sort = _.get(event, 'queryStringParameters.sort', '').split(',').filter(x => !!x)
      const limit = _.toSafeInteger(_.get(event, 'queryStringParameters.limit')) || 100
      const skip = _.toSafeInteger(_.get(event, 'queryStringParameters.skip')) || 0
      const query = _.get(event, 'queryStringParameters.q', '').split(' ').filter(x => !!x)
      var sortFields = {}
      var filter = {}

      _.forIn(_.get(event, 'queryStringParameters'), (v, k) => {
        if (k.includes('.')) {
          const fieldArray = k.split('.')
          let field = _.get(fieldArray, 0)
          let type = _.get(fieldArray, 1)
          let operator = _.get(fieldArray, 2)
          let value

          switch (type) {
            case 'reference':
              value = _h.strToId(v)
              break
            case 'boolean':
              value = v.toLowerCase() === 'true'
              break
            case 'integer':
              value = _.toNumber(v)
              break
            case 'filesize':
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
              if (operator === 'regex' && v.includes('/')) {
                value = new RegExp(v.split('/')[1], v.split('/')[2])
              } else if (operator === 'exists') {
                value = v.toLowerCase() === 'true'
              } else {
                value = v
              }
          }

          if (['gt', 'gte', 'lt', 'lte', 'ne', 'regex', 'exists'].includes(operator)) {
            _.set(filter, [`private.${field}.${type}`, `$${operator}`], value)
          } else {
            filter[`private.${field}.${type}`] = value
          }
        }
      })

      if (user.id) {
        filter.access = { '$in': [_h.strToId(user.id), 'public'] }
      } else {
        filter.access = 'public'
      }

      if (query.length > 0) {
        let queries = query.map((q) => {
          if (user.id) {
            return { 'search.private': new RegExp(q.toLowerCase(), 'i') }
          } else {
            return { 'search.public': new RegExp(q.toLowerCase(), 'i') }
          }
        })
        filter['$and'] = queries
      }

      if (sort.length > 0) {
        sort.forEach((f) => {
          if (f.startsWith('-')) {
            sortFields[`private.${f.substring(1)}`] = -1
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

      let cleanedEntities = []
      for (let i = 0; i < entities.length; i++) {
        const entity = await claenupEntity(entities[i], user, getThumbnail)

        if (entity) {
          cleanedEntities.push(entity)
        }
      }

      result = {
        count: count,
        filter: filter,
        props: props,
        entities: cleanedEntities
      }
    }

    return _h.json(result)
  } catch (e) {
    return _h.error(e)
  }
}

// Return public or private properties (based user rights)
const claenupEntity = async (entity, user, _thumbnail) => {
  if (!entity) { return }

  let result = { _id: entity._id }

  const access = _.get(entity, 'access', []).map((s) => s.toString())

  if (user.id && access.includes(user.id)) {
    result = Object.assign({}, result, _.get(entity, 'private', {}))
  } else if (access.includes('public')) {
    result = Object.assign({}, result, _.get(entity, 'public', {}))
  } else {
    return
  }

  if (_thumbnail && _.has(result, 'photo.0.s3')) {
    result._thumbnail = await _h.getSignedUrl('getObject', { Key: _.get(result, 'photo.0.s3') })
  }

  if (_.has(result, 'entu_api_key')) {
    _.get(result, 'entu_api_key', []).forEach((k) => {
      k.string = '***'
    })
  }

  if (!result._thumbnail) {
    delete result._thumbnail
  }

  return result
}
