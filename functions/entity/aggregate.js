'use strict'

const _ = require('lodash')
const _h = require('helpers')

exports.handler = async (event, context) => {
  if (event.source === 'aws.events') return _h.json({ message: 'OK' })

  const results = []

  if (event.Records?.length > 0) {
    console.log('SQS_RECORDS', event.Records.length)

    for (let n = 0; n < event.Records.length; n++) {
      const body = JSON.parse(event.Records[n].body)

      results.push(await aggregate(context, body.account, body.entity, body.dt))
    }
  } else {
    const user = await _h.user(event)

    results.push(await aggregate(context, user.account, event.pathParameters._id, event.queryStringParameters?.date))
  }

  console.log('RESULTS', JSON.stringify(results, null, 2))

  return { results }
}

async function aggregate (context, account, entityId, date) {
  const database = await _h.db(account)
  const eId = _h.strToId(entityId)

  const entity = await database.collection('entity').findOne({ _id: eId }, {
    projection: {
      aggregated: true,
      'private.name': true,
      'private._type': true,
      'private._noaccess': true,
      'private._viewer': true,
      'private._expander': true,
      'private._editor': true,
      'private._owner': true
    }
  })

  if (!entity) return _h.error([404, 'Entity not found'])

  // skip if already aggregated
  if (entity && entity.aggregated && date && entity.aggregated >= new Date(date)) {
    console.log(`SKIP ${eId.toString()}`)

    return {
      account,
      entity: eId,
      ignored: true,
      message: `Entity is already aggregated at ${entity.aggregated.toISOString()}`
    }
  }

  const properties = await database.collection('property').find({ entity: eId, deleted: { $exists: false } }).toArray()

  // delete entity
  if (properties.some(x => x.type === '_deleted')) {
    await database.collection('entity').deleteOne({ _id: eId })

    console.log(`DELETED ${eId.toString()}`)

    return {
      account,
      entity: eId,
      deleted: true,
      message: 'Entity is deleted'
    }
  }

  const newEntity = await propertiesToEntity(database, properties)

  // get info from type
  if (newEntity.private._type) {
    const definition = await database.collection('entity').aggregate([
      {
        $match: {
          'private._parent.reference': newEntity.private._type.at(0).reference,
          'private._type.string': 'property',
          'private.name.string': { $exists: true }
        }
      }, {
        $project: {
          _id: false,
          name: { $arrayElemAt: ['$private.name.string', 0] },
          public: { $arrayElemAt: ['$private.public.boolean', 0] },
          search: { $arrayElemAt: ['$private.search.boolean', 0] },
          formula: { $arrayElemAt: ['$private.formula.string', 0] }
        }
      }
    ]).toArray()

    for (let d = 0; d < definition.length; d++) {
      if (definition[d].formula) {
        newEntity.private[definition[d].name] = [await formula(definition[d].formula, eId, database)]
      }

      const dValue = newEntity.private[definition[d].name]

      if (definition[d].search && dValue) {
        newEntity.search.private = [...new Set([
          ...(newEntity.search.private || []),
          ...getValueArray(dValue)
        ])].map((x) => x.toLowerCase())

        if (definition[d].public) {
          newEntity.search.public = [...new Set([
            ...(newEntity.search.public || []),
            ...getValueArray(dValue)
          ])].map((x) => x.toLowerCase())
        }
      }

      if (definition[d].public && dValue) {
        newEntity.public[definition[d].name] = dValue
      }
    }
  } else {
    console.log(`NO_TYPE ${newEntity.private._type} ${eId.toString()}`)
  }

  // get and set parent rights
  let parentRights = {}
  if (newEntity.private._parent?.length > 0 && newEntity.private._inheritrights?.at(0)?.boolean === true) {
    parentRights = await getParentRights(account, newEntity.private._parent)
    if (parentRights._viewer) { newEntity.private._parent_viewer = _.uniqBy(parentRights._viewer, (x) => x.reference.toString()) }
    if (parentRights._expander) { newEntity.private._parent_expander = _.uniqBy(parentRights._expander, (x) => x.reference.toString()) }
    if (parentRights._editor) { newEntity.private._parent_editor = _.uniqBy(parentRights._editor, (x) => x.reference.toString()) }
    if (parentRights._owner) { newEntity.private._parent_owner = _.uniqBy(parentRights._owner, (x) => x.reference.toString()) }
  }

  // combine rights
  const noRights = newEntity.private._noaccess?.map((x) => x.reference.toString())

  newEntity.private._owner = _.uniqBy([
    ...(parentRights._owner || []),
    ...(newEntity.private._owner || [])
  ], (x) => [x.reference.toString(), x.inherited || false].join('-')).filter(x => !noRights?.includes(x.reference.toString()))

  newEntity.private._editor = _.uniqBy([
    ...(parentRights._editor || []),
    ...(newEntity.private._editor || []),
    ...(newEntity.private._owner || [])
  ], (x) => [x.reference.toString(), x.inherited || false].join('-')).filter(x => !noRights?.includes(x.reference.toString()))

  newEntity.private._expander = _.uniqBy([
    ...(parentRights._expander || []),
    ...(newEntity.private._expander || []),
    ...(newEntity.private._editor || [])
  ], (x) => [x.reference.toString(), x.inherited || false].join('-')).filter(x => !noRights?.includes(x.reference.toString()))

  newEntity.private._viewer = _.uniqBy([
    ...(parentRights._viewer || []),
    ...(newEntity.private._viewer || []),
    ...(newEntity.private._expander || [])
  ], (x) => [x.reference.toString(), x.inherited || false].join('-')).filter(x => !noRights?.includes(x.reference.toString()))

  const { _noaccess, _viewer, _expander, _editor, _owner } = combineRights({
    _noaccess: newEntity.private._noaccess,
    _viewer: newEntity.private._viewer,
    _expander: newEntity.private._expander,
    _editor: newEntity.private._editor,
    _owner: newEntity.private._owner
  })

  if (_noaccess) { newEntity.private._noaccess = _noaccess }
  if (_viewer) { newEntity.private._viewer = _viewer }
  if (_expander) { newEntity.private._expander = _expander }
  if (_editor) { newEntity.private._editor = _editor }
  if (_owner) { newEntity.private._owner = _owner }

  newEntity.access = getAccessArray(newEntity)

  if (!newEntity.access.includes('public') || Object.keys(newEntity.public).length === 0) {
    delete newEntity.public
  }

  await database.collection('entity').replaceOne({ _id: eId }, newEntity, { upsert: true })

  const sqsLength = await startRelativeAggregation(context, account, database, entity, newEntity)

  console.log(`UPDATED_SQS ${eId.toString()}`)

  return {
    _id: eId,
    account,
    updated: true,
    sqsLength,
    message: `Entity updated and added ${sqsLength} entities to SQS`
  }
}

async function propertiesToEntity (database, properties) {
  const entity = {
    aggregated: new Date(),
    private: {},
    public: {},
    access: [],
    search: {}
  }

  for (let n = 0; n < properties.length; n++) {
    const prop = properties[n]
    let cleanProp = _.omit(prop, ['entity', 'type', 'created', 'search', 'public'])

    if (!entity.private[prop.type]) {
      entity.private[prop.type] = []
    }

    if (prop.reference) {
      const referenceEntity = await database.collection('entity').findOne({ _id: prop.reference }, { projection: { _id: false, 'private.name': true, 'private._type': true } })

      if (referenceEntity) {
        cleanProp = { ...cleanProp, property_type: prop.type, string: referenceEntity.private?.name?.[0].string, entity_type: referenceEntity.private?._type?.[0].string }
      } else {
        cleanProp = { ...cleanProp, property_type: prop.type, string: prop.reference.toString() }
        console.log(`NO_REFERENCE ${prop.reference.toString()}`)
      }

      if (!prop.type.startsWith('_')) {
        if (entity.private._reference) {
          entity.private._reference = [...entity.private._reference, cleanProp]
        } else {
          entity.private._reference = [cleanProp]
        }
      }
    }

    entity.private[prop.type] = [...entity.private[prop.type], _.omit(cleanProp, ['property_type', 'entity_type'])]
  }

  return entity
}

async function formula (str, eId, db) {
  const strArray = str.trim().match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)

  const func = formulaFunction(strArray)
  const data = formulaContent(strArray, func)

  let valueArray = []

  for (let i = 0; i < data.length; i++) {
    const value = await formulaField(data[i], eId, db)

    if (value) {
      valueArray = [...valueArray, ...value]
    }
  }

  valueArray = getValueArray(valueArray)

  switch (func) {
    case 'CONCAT':
      return { string: valueArray.join('') }
    case 'COUNT':
      return { number: valueArray.length }
    case 'SUM':
      return { number: valueArray.reduce((a, b) => a + b, 0) }
    case 'SUBTRACT':
      return { number: valueArray.reduce((a, b) => a - b, 0) + (valueArray.at(0) * 2) }
    case 'AVERAGE':
      return { number: valueArray.reduce((a, b) => a + b, 0) / valueArray.length }
    case 'MIN':
      return { number: Math.min(...valueArray) }
    case 'MAX':
      return { number: Math.max(...valueArray) }
    default:
      return { string: valueArray.join('') }
  }
}

async function formulaField (str, eId, db) {
  str = str.trim()

  if ((str.startsWith("'") || str.startsWith('"')) && (str.endsWith("'") || str.endsWith('"'))) {
    return [{
      string: str.substring(1, str.length - 1)
    }]
  }

  if (parseFloat(str).toString() === str) {
    return [{
      number: parseFloat(str)
    }]
  }

  const strParts = str.split('.')

  const [fieldRef, fieldType, fieldProperty] = str.split('.')

  let result

  // same entity _id
  if (strParts.length === 1 && str === '_id') {
    result = [{ _id: eId }]

  // same entity property
  } else if (strParts.length === 1 && str !== '_id') {
    result = await db.collection('property').find({
      entity: eId,
      type: str,
      string: { $exists: true },
      deleted: { $exists: false }
    }, {
      sort: { _id: 1 },
      projection: { _id: false, entity: false, type: false }
    }).toArray()

  // childs _id
  } else if (strParts.length === 3 && fieldRef === '_child' && fieldType === '*' && fieldProperty === '_id') {
    result = await db.collection('entity').find({
      'private._parent.reference': eId
    }, {
      projection: { _id: true }
    }).toArray()

  // childs (with type) property
  } else if (strParts.length === 3 && fieldRef === '_child' && fieldType !== '*' && fieldProperty === '_id') {
    result = await db.collection('entity').find({
      'private._parent.reference': eId,
      'private._type.string': fieldType
    }, {
      projection: { _id: true }
    }).toArray()

  // childs property
  } else if (strParts.length === 3 && fieldRef === '_child' && fieldType === '*' && fieldProperty !== '_id') {
    result = await db.collection('entity').aggregate([
      {
        $match: { 'private._parent.reference': eId }
      }, {
        $lookup: {
          from: 'property',
          let: { eId: '$_id' },
          pipeline: [
            {
              $match: {
                type: fieldProperty,
                deleted: { $exists: false },
                $expr: { $eq: ['$entity', '$$eId'] }
              }
            }, {
              $project: { _id: false, entity: false, type: false, created: false }
            }
          ],
          as: 'properties'
        }
      }, {
        $project: { properties: true }
      }, {
        $unwind: '$properties'
      }, {
        $replaceWith: '$properties'
      }
    ]).toArray()

  // childs (with type) property
  } else if (strParts.length === 3 && fieldRef === '_child' && fieldType !== '*' && fieldProperty !== '_id') {
    result = await db.collection('entity').aggregate([
      {
        $match: {
          'private._parent.reference': eId,
          'private._type.string': fieldType
        }
      }, {
        $lookup: {
          from: 'property',
          let: { eId: '$_id' },
          pipeline: [
            {
              $match: {
                type: fieldProperty,
                deleted: { $exists: false },
                $expr: { $eq: ['$entity', '$$eId'] }
              }
            }, {
              $project: { _id: false, entity: false, type: false, created: false }
            }
          ],
          as: 'properties'
        }
      }, {
        $project: { properties: true }
      }, {
        $unwind: '$properties'
      }, {
        $replaceWith: '$properties'
      }
    ]).toArray()

  // parents _id
  } else if (strParts.length === 3 && fieldRef === '_parent' && fieldType === '*' && fieldProperty === '_id') {
    result = await db.collection('property').aggregate([
      {
        $match: {
          entity: eId,
          type: '_parent',
          reference: { $exists: true },
          deleted: { $exists: false }
        }
      }, {
        $project: { _id: '$reference' }
      }
    ]).toArray()

  // parents (with type) _id
  } else if (strParts.length === 3 && fieldRef === '_parent' && fieldType !== '*' && fieldProperty === '_id') {
    result = await db.collection('property').aggregate([
      {
        $match: {
          entity: eId,
          type: '_parent',
          reference: { $exists: true },
          deleted: { $exists: false }
        }
      }, {
        $lookup: {
          from: 'entity',
          let: { eId: '$reference' },
          pipeline: [
            {
              $match: {
                'private._type.string': fieldType,
                $expr: { $eq: ['$_id', '$$eId'] }
              }
            }, {
              $project: { _id: true }
            }
          ],
          as: 'parents'
        }
      }, {
        $unwind: '$parents'
      }, {
        $replaceWith: '$parents'
      }
    ]).toArray()

  // parents property
  } else if (strParts.length === 3 && fieldRef === '_parent' && fieldType === '*' && fieldProperty !== '_id') {
    result = await db.collection('property').aggregate([
      {
        $match: {
          entity: eId,
          type: '_parent',
          reference: { $exists: true },
          deleted: { $exists: false }
        }
      }, {
        $lookup: {
          from: 'property',
          let: { eId: '$reference' },
          pipeline: [
            {
              $match: {
                type: fieldProperty,
                deleted: { $exists: false },
                $expr: { $eq: ['$entity', '$$eId'] }
              }
            }, {
              $project: { _id: false, entity: false, type: false, created: false }
            }
          ],
          as: 'properties'
        }
      }, {
        $project: { properties: true }
      }, {
        $unwind: '$properties'
      }, {
        $replaceWith: '$properties'
      }
    ]).toArray()

  // parents (with type) property
  } else if (strParts.length === 3 && fieldRef === '_parent' && fieldType !== '*' && fieldProperty !== '_id') {
    result = await db.collection('property').aggregate([
      {
        $match: {
          entity: eId,
          type: '_parent',
          reference: { $exists: true },
          deleted: { $exists: false }
        }
      }, {
        $lookup: {
          from: 'entity',
          let: { eId: '$reference' },
          pipeline: [
            {
              $match: {
                'private._type.string': fieldType,
                $expr: { $eq: ['$_id', '$$eId'] }
              }
            }, {
              $project: { _id: true }
            }
          ],
          as: 'parents'
        }
      }, {
        $lookup: {
          from: 'property',
          let: { eId: '$parents._id' },
          pipeline: [
            {
              $match: {
                type: fieldProperty,
                deleted: { $exists: false },
                $expr: { $in: ['$entity', '$$eId'] }
              }
            }, {
              $project: { _id: false, entity: false, type: false, created: false }
            }
          ],
          as: 'properties'
        }
      }, {
        $project: { properties: true }
      }, {
        $unwind: '$properties'
      }, {
        $replaceWith: '$properties'
      }
    ]).toArray()
  }

  return result
}

function formulaFunction (data) {
  const func = data.at(-1)

  if (['CONCAT', 'COUNT', 'SUM', 'SUBTRACT', 'AVERAGE', 'MIN', 'MAX'].includes(func)) {
    return func
  } else {
    return 'CONCAT'
  }
}

function formulaContent (data, func) {
  if (data.at(-1) === func) {
    return data.slice(0, -1)
  } else {
    return data
  }
}

function getValueArray (values) {
  if (!values) return []

  return values.map(x => x.number || x.datetime || x.date || x.string || x._id)
}

async function getParentRights (account, parents) {
  const database = await _h.db(account)

  const parentRights = await database.collection('entity').find({
    _id: { $in: parents.map(x => x.reference) }
  }, {
    projection: {
      _id: false,
      'private._noaccess': true,
      'private._viewer': true,
      'private._expander': true,
      'private._editor': true,
      'private._owner': true
    }
  }).toArray()

  const rights = combineRights(parentRights.reduce((acc, cur) => ({
    _viewer: [...acc._viewer, ...cur.private?._viewer],
    _expander: [...acc._expander, ...cur.private?._expander],
    _editor: [...acc._editor, ...cur.private?._editor],
    _owner: [...acc._owner, ...cur.private?._owner]
  }), {
    _viewer: [],
    _expander: [],
    _editor: [],
    _owner: []
  }))

  rights._noaccess = rights._noaccess?.map((x) => ({ ...x, inherited: true }))
  rights._viewer = rights._viewer?.map((x) => ({ ...x, inherited: true }))
  rights._expander = rights._expander?.map((x) => ({ ...x, inherited: true }))
  rights._editor = rights._editor?.map((x) => ({ ...x, inherited: true }))
  rights._owner = rights._owner?.map((x) => ({ ...x, inherited: true }))

  return rights
}

function combineRights (rights) {
  const directNoaccess = rights._noaccess?.filter((x) => x.inherited === undefined)?.map((x) => x.reference.toString()) || []
  const directViewers = rights._viewer?.filter((x) => x.inherited === undefined)?.map((x) => x.reference.toString()) || []
  const directExpanders = rights._expander?.filter((x) => x.inherited === undefined)?.map((x) => x.reference.toString()) || []
  const directEditors = rights._editor?.filter((x) => x.inherited === undefined)?.map((x) => x.reference.toString()) || []
  const directOwners = rights._owner?.filter((x) => x.inherited === undefined)?.map((x) => x.reference.toString()) || []

  rights._noaccess = rights._noaccess?.filter((x) => x.inherited === undefined || (x.inherited === true && !directNoaccess.includes(x.reference.toString())))
  rights._viewer = rights._viewer?.filter((x) => x.inherited === undefined || (x.inherited === true && !directViewers.includes(x.reference.toString())))
  rights._expander = rights._expander?.filter((x) => x.inherited === undefined || (x.inherited === true && !directExpanders.includes(x.reference.toString())))
  rights._editor = rights._editor?.filter((x) => x.inherited === undefined || (x.inherited === true && !directEditors.includes(x.reference.toString())))
  rights._owner = rights._owner?.filter((x) => x.inherited === undefined || (x.inherited === true && !directOwners.includes(x.reference.toString())))

  const noRights = rights._noaccess?.map((x) => x.reference.toString()) || []

  if (noRights.length > 0) {
    rights._viewer = rights._viewer?.filter((x) => !noRights.includes(x.reference.toString()))
    rights._expander = rights._expander?.filter((x) => !noRights.includes(x.reference.toString()))
    rights._editor = rights._editor?.filter((x) => !noRights.includes(x.reference.toString()))
    rights._owner = rights._owner?.filter((x) => !noRights.includes(x.reference.toString()))
  }

  return rights
}

function getAccessArray ({ private: entity }) {
  const access = []
  const noAccess = entity._noaccess?.map((x) => x.reference)

  if (entity._public?.at(0)?.boolean === true) {
    access.push('public')
  }

  ['_viewer', '_expander', '_editor', '_owner'].forEach((type) => {
    if (!entity[type]) return

    entity[type].forEach((x) => {
      if (noAccess?.includes(x.reference)) return

      access.push(x.reference)
    })
  })

  return _.uniqBy(access, (x) => x.toString())
}

async function startRelativeAggregation (context, account, database, entity, newEntity, date) {
  let notEqual = false
  const dt = date ? new Date(date) : newEntity.aggregated
  const rights = ['_noaccess', '_viewer', '_expander', '_editor', '_owner']

  const name = (entity.private?.name || []).map(x => x.string || '')
  const newName = (newEntity.private?.name || []).map(x => x.string || '')
  notEqual = notEqual || !_.isEqual(_.sortBy(name), _.sortBy(newName))

  rights.forEach((type) => {
    const oldRights = (entity.private[type] || []).map(x => x.reference?.toString())
    const newRights = (newEntity.private[type] || []).map(x => x.reference?.toString())
    notEqual = notEqual || !_.isEqual(_.sortBy(oldRights), _.sortBy(newRights))
  })

  if (!notEqual) return 0

  const referrers = await database.collection('property').aggregate([
    { $match: { reference: entity._id, deleted: { $exists: false } } },
    { $group: { _id: '$entity' } }
  ]).toArray()

  for (let j = 0; j < referrers.length; j++) {
    await _h.addEntityAggregateSqs(context, account, referrers[j]._id.toString(), dt)
  }

  return referrers.length
}
