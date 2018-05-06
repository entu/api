'use strict'

console.log('Loading function')

const _ = require('lodash')
const _h = require('./_helpers')
const async = require('async')
const ObjectId = require('mongodb').ObjectID



exports.handler = (event, context, callback) => {
  context.callbackWaitsForEmptyEventLoop = false

  _h.user(event, (err, user) => {
    if (err) { return callback(null, _h.error(err)) }
    if (!user.id) { return callback(null, _h.error([403, 'Forbidden'])) }

    const body = JSON.parse(event.body)

    if (!body) { return callback(null, _h.error([400, 'No data'])) }
    if (!body.type) { return callback(null, _h.error([400, 'No type'])) }

    var parent
    var eId
    var defaultParents = []
    var defaultValues = []
    var createdDt = new Date()

    async.waterfall([
      (callback) => { // get entity type
        user.db.collection('entity').findOne({ '_type.string': 'entity', 'key.string': body.type }, { projection: { default_parent: true } }, callback)
      },
      (type, callback) => {
        if (type && type.default_parent) {
          defaultParents = type.default_parent
        }

        if (!body.parent) {
          return callback(null, null)
        }

        user.db.collection('entity').findOne({ '_id': new ObjectId(body.parent) }, { projection: { _id: true, 'private._type': true, 'private._viewer': true, 'private._expander': true, 'private._editor': true, 'private._owner': true } }, (p, callback) => {
          parent = p

          if (!parent) { return callback([404, 'Parent entity not found']) }

          const access = _.map(_.concat(_.get(parent, 'private._owner', []), _.get(parent, 'private._editor', []), _.get(parent, 'private._expander', [])), (s) => {
            return s.reference.toString()
          })

          if (access.indexOf(user.id) === -1) { return callback([403, 'Forbidden']) }

          user.db.collection('entity').find({ _parent: type._id, 'private._type.string': 'property', 'default': { $exists: true } }, { projection: { _id: false, default: true } }, callback)
        })
      },
      (defaults, callback) => {
        // defaultValues = _.map(defaults.default, 'reference')

        user.db.collection('entity').insertOne({}, callback)
      },
      (entity, callback) => {
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

        user.db.collection('property').insertMany(properties, callback)
      },
      (r, callback) => { // Aggregate entity
        _h.aggregateEntity(user.db, eId, null, callback)
      }
    ], (err) => {
      if (err) { return callback(null, _h.error(err)) }

      callback(null, _h.json({ _id: eId }))
    })
  })
}
