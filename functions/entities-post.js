'use strict'

const _ = require('lodash')
const _h = require('./_helpers')
const { ObjectId } = require('mongodb')

exports.handler = async (event, context) => {
  if (event.source === 'aws.events') { return }

  try {
    const user = await _h.user(event)
    if (!user.id) { return _h.error([403, 'Forbidden']) }

    const body = JSON.parse(event.body)
    if (!body) { return _h.error([400, 'No data']) }
    if (!body.type) { return _h.error([400, 'No type']) }

    var eId
    var parent
    // var defaultValues = []
    var createdDt = new Date()

    const type = await user.db.collection('entity').findOne({ '_type.string': 'entity', 'key.string': body.type }, { projection: { default_parent: true } })

    const defaultParents = (type && type.default_parent) ? type.default_parent : []

    if (body.parent) {
      parent = user.db.collection('entity').findOne({ '_id': new ObjectId(body.parent) }, { projection: { _id: true, 'private._type': true, 'private._viewer': true, 'private._expander': true, 'private._editor': true, 'private._owner': true } })

      if (!parent) { return _h.error([404, 'Parent entity not found']) }

      const access = _.map(_.concat(_.get(parent, 'private._owner', []), _.get(parent, 'private._editor', []), _.get(parent, 'private._expander', [])), (s) => {
        return s.reference.toString()
      })

      if (access.indexOf(user.id) === -1) { return _h.error([403, 'Forbidden']) }

      // const defaults = await user.db.collection('entity').find({ _parent: type._id, 'private._type.string': 'property', 'default': { $exists: true } }, { projection: { _id: false, default: true } })
      // defaultValues = _.map(defaults.default, 'reference')
    }

    const entity = await user.db.collection('entity').insertOne({})
    eId = entity.insertedId

    let userId = new ObjectId(user.id)
    let properties = []

    _.forEach(defaultParents, (p) => {
      properties.push({ entity: eId, type: '_parent', reference: p.reference, created: { at: createdDt, by: userId } })
    })

    if (parent) {
      _.forEach(parent._viewer, (pViewer) => {
        if (pViewer.reference === userId) { return }
        properties.push({ entity: eId, type: '_viewer', reference: pViewer.reference, created: { at: createdDt, by: userId } })
      })
      _.forEach(parent._expander, (pExpander) => {
        if (pExpander.reference === userId) { return }
        properties.push({ entity: eId, type: '_expander', reference: pExpander.reference, created: { at: createdDt, by: userId } })
      })
      _.forEach(parent._editor, (pEditor) => {
        if (pEditor.reference === userId) { return }
        properties.push({ entity: eId, type: '_editor', reference: pEditor.reference, created: { at: createdDt, by: userId } })
      })
      _.forEach(parent._owner, (pOwner) => {
        if (pOwner.reference === userId) { return }
        properties.push({ entity: eId, type: '_owner', reference: pOwner.reference, created: { at: createdDt, by: userId } })
      })
      properties.push({ entity: eId, type: '_parent', reference: parent._id, created: { at: createdDt, by: userId } })
    }
    properties.push({ entity: eId, type: '_owner', reference: userId, created: { at: createdDt, by: userId } })

    properties.push({ entity: eId, type: '_type', string: body.type, created: { at: createdDt, by: userId } })
    properties.push({ entity: eId, type: '_created', boolean: true, created: { at: createdDt, by: userId } })

    await user.db.collection('property').insertMany(properties)
    await _h.aggregateEntity(user.db, eId, null)

    return _h.json({ _id: eId })
  } catch (e) {
    return _h.error(e)
  }
}
