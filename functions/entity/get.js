'use strict'

const _forIn = require('lodash/forIn')
const _set = require('lodash/set')
const _toNumber = require('lodash/toNumber')
const _toSafeInteger = require('lodash/toSafeInteger')
const _h = require('helpers')

exports.handler = async (event, context) => {
  if (event.source === 'aws.events') return _h.json({ message: 'OK' })

  try {
    await _h.addStats(event, context.functionName)

    const user = await _h.user(event)
    const eId = event.pathParameters?._id ? _h.strToId(event.pathParameters._id) : null
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
      const query = (event.queryStringParameters?.q || '').toLowerCase().split(' ').filter(x => !!x)
      let sortFields = {}
      const filter = {}
      let search
      const equalSearch = []

      _forIn(event.queryStringParameters || {}, (v, k) => {
        if (k.includes('.')) {
          const fieldArray = k.split('.')
          const field = fieldArray.at(0)
          const type = fieldArray.at(1)
          const operator = fieldArray.at(2)
          let value

          switch (type) {
            case 'reference':
              value = _h.strToId(v)
              break
            case 'boolean':
              value = v.toLowerCase() === 'true'
              break
            case 'number':
              value = _toNumber(v)
              break
            case 'filesize':
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
                value = new RegExp(v.split('/').at(1), v.split('/').at(2))
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
            equalSearch.push({ text: { path: `private.${field}.${type}`, query: value } })
          }
        }
      })

      if (user.id) {
        filter.access = { $in: [_h.strToId(user.id), 'public'] }
      } else {
        filter.access = 'public'
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

      if (query.length > 0) {
        _set(filter, ['$text', '$search'], query.map(x => `"${x}"`).join(' '))
        _set(filter, [user.id ? 'search.private' : 'search.public', '$all'], query.map(x => new RegExp(x)))
      }

      const cleanedEntities = []
      let entities = 0
      let count = 0
      let pipeline = [{ $match: filter }]

      if (group.length > 0) {
        const groupIds = {}
        const unwinds = []
        const groupFields = { access: { $first: '$access' } }
        const projectIds = {
          'public._count': '$_count',
          'private._count': '$_count',
          access: true,
          _id: false
        }

        group.forEach((g) => {
          groupIds[g.replaceAll('.', '#')] = `$private.${g}`
          unwinds.push({ $unwind: { path: `$private.${g.split('.').at(0)}`, preserveNullAndEmptyArrays: true } })
        })

        Object.keys(fields).forEach((g) => {
          groupFields[g.replaceAll('.', '#')] = { $first: `$${g}` }
          projectIds[g] = `$${g.replaceAll('.', '#')}`
        })

        pipeline = [
          ...pipeline,
          ...unwinds,
          { $group: { ...groupFields, _id: groupIds, _count: { $count: {} } } },
          { $project: projectIds },
          { $sort: sortFields }
        ]

        if (!search) {
          pipeline.push({ $sort: sortFields })
        }
      } else {
        pipeline.push({ $sort: sortFields })
        pipeline.push({ $skip: skip })
        pipeline.push({ $limit: limit })

        if (props.length > 0) {
          const projectIds = { access: true }

          Object.keys(fields).forEach((g) => {
            projectIds[g] = true
          })

          pipeline.push({ $project: projectIds })
        }
      }

      const countPipeline = [
        ...pipeline.filter((x) => !Object.keys(x).includes('$sort') && !Object.keys(x).includes('$skip') && !Object.keys(x).includes('$limit')),
        { $count: '_count' }
      ]

      entities = await user.db.collection('entity').aggregate(pipeline).toArray()
      count = await user.db.collection('entity').aggregate(countPipeline).toArray()

      for (let i = 0; i < entities.length; i++) {
        const entity = await claenupEntity(entities[i], user, getThumbnail)

        if (entity) cleanedEntities.push(entity)
      }

      result = {
        entities: cleanedEntities,
        count: count?.at(0)?._count || 0,
        limit,
        skip
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

  if (_thumbnail && result.photo?.at(0)?.s3) {
    result._thumbnail = await _h.getSignedDownloadUrl(result.photo.at(0).s3)
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
