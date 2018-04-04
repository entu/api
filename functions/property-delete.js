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
        if (!user.id) { return callback(null, _h.error([403, 'Forbidden'])) }

        const pId = new objectId(event.pathParameters.id)
        var property

        async.waterfall([
            (callback) => {
                user.db.collection('property').findOne({ _id: pId, deleted: { $exists: false } }, { projection: {_id: false, entity: true, type: true }}, callback)
            },
            (prop, callback) => {
                if (!prop) { return callback([404, 'Property not found']) }
                if (prop.type.substr(0, 1) === '_') { return callback([403, 'Can\'t delete system property']) }

                property = prop

                user.db.collection('entity').findOne({ _id: property.entity }, { projection: { _id: false, 'private._owner': true, 'private._editor': true } }, callback)
            },
            (entity, callback) => {
                if (!entity) { return callback([404, 'Entity not found']) }

                const access = _.map(_.concat(_.get(entity, 'private._owner', []), _.get(entity, 'private._editor', [])), (s) => {
                    return s.reference.toString()
                })

                if (access.indexOf(user.id) === -1) { return callback([403, 'Forbidden']) }

                user.db.collection('property').updateOne({ _id: pId }, { $set: { deleted: { at: new Date(), by: new objectId(user.id) } } }, callback)
            },
            (r, callback) => { // Aggregate entity
                _h.aggregateEntity(user.db, property.entity, property.type, callback)
            }
        ], (err) => {
            if (err) { return callback(null, _h.error(err)) }

            callback(null, _h.json({ deleted: true }))
        })
    })
}
