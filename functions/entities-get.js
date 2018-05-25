'use strict'

const _ = require('lodash')
const _h = require('./_helpers')
const { ObjectId } = require('mongodb')

exports.handler = async (event, context) => {
  if (event.source === 'aws.events') { return }

  try {
    const user = await _h.user(event)
    const props = _.compact(_.get(event, 'queryStringParameters.props', '').split(','))
    const sort = _.compact(_.get(event, 'queryStringParameters.sort', '').split(','))
    var filter = {}
    var fields = {}
    var sortFields = {}
    var limit = _.toSafeInteger(_.get(event, 'queryStringParameters.limit')) || 100
    var skip = _.toSafeInteger(_.get(event, 'queryStringParameters.skip')) || 0
    var query = _.compact(_.get(event, 'queryStringParameters.q', '').split(' '))

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

    if (query.length > 0) {
      let queries = query.map((q) => {
        return { 'search.private': new RegExp(q.toLowerCase()) }
      })
      filter['$and'] = queries
    }

    if (props.length > 0) {
      _.forEach(props, (f) => {
        if (f === '_thumbnail') {
          fields[`private.photo.s3`] = true
          fields[`public.photo.s3`] = true
        } else {
          fields[`private.${f}`] = true
          fields[`public.${f}`] = true
        }
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

    let cleanedEntities = []
    for (let i = 0; i < entities.length; i++) {
      let result = await _h.claenupEntity(entities[i], user)
      if (result) {
        cleanedEntities.push(result)
      }
    }

    return _h.json({
      count: count,
      entities: cleanedEntities
    })
  } catch (e) {
    return _h.error(e)
  }
}
