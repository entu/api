'use strict'

const _forIn = require('lodash/forIn')
const _get = require('lodash/get')
const _has = require('lodash/has')
const _set = require('lodash/set')
const _toNumber = require('lodash/toNumber')
const _toSafeInteger = require('lodash/toSafeInteger')
const _h = require('../_helpers')

exports.handler = async (event, context) => {
  if (event.source === 'aws.events') { return _h.json({ message: 'OK' }) }

  try {
    const user = await _h.user(event)
    const eId = event.pathParameters && event.pathParameters.id ? _h.strToId(event.pathParameters.id) : null
    const props = _get(event, 'queryStringParameters.props', '').split(',').filter((x) => !!x)
    const fields = {}
    let result = {}
    let getThumbnail = props.length === 0

    if (props.length > 0) {
      props.forEach((f) => {
        if (f === '_thumbnail') {
          fields['private.photo.s3'] = true
          fields['public.photo.s3'] = true
          getThumbnail = true
        } else {
          fields[`private.${f}`] = true
          fields[`public.${f}`] = true
        }
      })
      fields.access = true
    }

    if (eId) {
      const entity = await user.db.collection('entity').findOne({
        _id: eId
      }, {
        projection: fields
      })
      if (!entity) { return _h.error([404, 'Entity not found']) }

      const cleanedEntity = await claenupEntity(entity, user, getThumbnail)

      if (!cleanedEntity) { return _h.error([403, 'No accessible properties']) }

      result = {
        filter: { _id: eId },
        props: props,
        entity: cleanedEntity
      }
    } else {
      const sort = _get(event, 'queryStringParameters.sort', '').split(',').filter(x => !!x)
      const limit = _toSafeInteger(_get(event, 'queryStringParameters.limit')) || 100
      const skip = _toSafeInteger(_get(event, 'queryStringParameters.skip')) || 0
      const query = _get(event, 'queryStringParameters.q', '').split(' ').filter(x => !!x)
      let sortFields = {}
      const filter = {}

      _forIn(_get(event, 'queryStringParameters'), (v, k) => {
        if (k.includes('.')) {
          const fieldArray = k.split('.')
          const field = _get(fieldArray, 0)
          const type = _get(fieldArray, 1)
          const operator = _get(fieldArray, 2)
          let value

          switch (type) {
            case 'reference':
              value = _h.strToId(v)
              break
            case 'boolean':
              value = v.toLowerCase() === 'true'
              break
            case 'integer':
              value = _toNumber(v)
              break
            case 'filesize':
              value = _toNumber(v)
              break
            case 'decimal':
              value = _toNumber(v)
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
            _set(filter, [`private.${field}.${type}`, `$${operator}`], value)
          } else {
            filter[`private.${field}.${type}`] = value
          }
        }
      })

      if (user.id) {
        filter.access = { $in: [_h.strToId(user.id), 'public'] }
      } else {
        filter.access = 'public'
      }

      if (query.length > 0) {
        const queries = query.map((q) => {
          if (user.id) {
            return { 'search.private': new RegExp(q.toLowerCase(), 'i') }
          } else {
            return { 'search.public': new RegExp(q.toLowerCase(), 'i') }
          }
        })
        filter.$and = queries
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

      const cleanedEntities = []
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

  const access = _get(entity, 'access', []).map((s) => s.toString())

  if (user.id && access.includes(user.id)) {
    result = Object.assign({}, result, _get(entity, 'private', {}))
  } else if (access.includes('public')) {
    result = Object.assign({}, result, _get(entity, 'public', {}))
  } else {
    return
  }

  if (_thumbnail && _has(result, 'photo.0.s3')) {
    result._thumbnail = await _h.getSignedUrl('getObject', { Key: _get(result, 'photo.0.s3') })
  }

  if (_has(result, 'entu_api_key')) {
    _get(result, 'entu_api_key', []).forEach((k) => {
      k.string = '***'
    })
  }

  if (!result._thumbnail) {
    delete result._thumbnail
  }

  return result
}
