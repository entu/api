'use strict'

const _forIn = require('lodash/forIn')
const _set = require('lodash/set')
const _toNumber = require('lodash/toNumber')
const _toSafeInteger = require('lodash/toSafeInteger')
const _h = require('helpers')

exports.handler = async (event, context) => {
  if (event.source === 'aws.events') return _h.json({ message: 'OK' })

  try {
    const user = await _h.user(event)
    const eId = event.pathParameters && event.pathParameters._id ? _h.strToId(event.pathParameters._id) : null
    const props = (event.queryStringParameters?.props || '').split(',').filter((x) => !!x)
    const group = (event.queryStringParameters?.group || '').split(',').filter((x) => !!x)
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
      if (!entity) return _h.error([404, 'Entity not found'])

      const cleanedEntity = await claenupEntity(entity, user, getThumbnail)

      if (!cleanedEntity) return _h.error([403, 'No accessible properties'])

      result = {
        filter: { _id: eId },
        props,
        entity: cleanedEntity
      }
    } else {
      const sort = (event.queryStringParameters?.sort || '').split(',').filter(x => !!x)
      const limit = _toSafeInteger(event.queryStringParameters?.limit) || 100
      const skip = _toSafeInteger(event.queryStringParameters?.skip) || 0
      const query = (event.queryStringParameters?.q || '').split(' ').filter(x => !!x)
      let sortFields = {}
      const filter = {}

      _forIn(event.queryStringParameters, (v, k) => {
        if (k.includes('.')) {
          const fieldArray = k.split('.')
          const field = fieldArray[0]
          const type = fieldArray[1]
          const operator = fieldArray[2]
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
            case 'double':
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

      const cleanedEntities = []
      let entities = 0
      let count = 0

      if (group.length > 0) {
        const groupIds = {}
        const unwinds = []
        const groupFields = { access: { $first: '$access' } }
        const projectIds = { 'public._count': '$_count', 'private._count': '$_count', access: true, _id: false }

        group.forEach((g) => {
          groupIds[g.replaceAll('.', '#')] = `$private.${g}`
          unwinds.push({ $unwind: { path: `$private.${g.split('.')[0]}`, preserveNullAndEmptyArrays: true } })
        })

        Object.keys(fields).forEach((g) => {
          groupFields[g.replaceAll('.', '#')] = { $first: `$${g}` }
          projectIds[g] = `$${g.replaceAll('.', '#')}`
        })

        entities = await user.db.collection('entity').aggregate([
          { $match: filter },
          ...unwinds,
          { $group: { ...groupFields, _id: groupIds, _count: { $count: {} } } },
          { $project: projectIds },
          { $sort: sortFields }
        ]).toArray()
        count = entities.length
      } else {
        entities = await user.db.collection('entity').find(filter, { projection: fields }).sort(sortFields).skip(skip).limit(limit).toArray()
        count = await user.db.collection('entity').countDocuments(filter)
      }

      for (let i = 0; i < entities.length; i++) {
        const entity = await claenupEntity(entities[i], user, getThumbnail)

        if (entity) cleanedEntities.push(entity)
      }

      result = {
        count,
        filter,
        props,
        group,
        sort,
        limit,
        skip,
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
  if (!entity) return

  let result = { _id: entity._id }

  const access = (entity.access || []).map((s) => s.toString())

  if (user.id && access.includes(user.id)) {
    result = { ...result, ...entity.private }
  } else if (access.includes('public')) {
    result = { ...result, ...entity.public }
  } else {
    return
  }

  if (_thumbnail && result.photo?.[0]?.s3) {
    result._thumbnail = await _h.getSignedDownloadUrl(result.photo[0].s3)
  }

  if (result.entu_api_key) {
    (result.entu_api_key || []).forEach((k) => {
      k.string = '***'
    })
  }

  if (!result._thumbnail) {
    delete result._thumbnail
  }

  _forIn(result, (v, k) => {
    if (v === null || v === undefined || v === '') delete result[k]
  })

  return result
}
