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

        var eId = new objectId(event.pathParameters.id)

        async.waterfall([
            (callback) => { // Get entity
                user.db.collection('entity').findOne({ _id: eId }, { _id: false, 'private._owner': true }, callback)
            },
            (entity, callback) => { // Check rights and create _deleted property
                if (!entity) { return callback([404, 'Entity not found']) }

                const access = _.map(_.get(entity, 'private._owner', []), (s) => {
                    return s.reference.toString()
                })

                if (access.indexOf(user.id) === -1) { return callback([403, 'Forbidden']) }

                user.db.collection('property').insertOne({ entity: eId, type: '_deleted', boolean: true, created: { at: new Date(), by: new objectId(user.id) } }, callback)
            },
            (r, callback) => { // Aggregate entity
                _h.aggregateEntity(user.db, eId, '_deleted', callback)
            },
            (r, callback) => { // Get reference properties
                user.db.collection('property').find({ reference: eId, deleted: { $exists: false } }, { entity: true, type: true }).toArray(callback)
            },
            (properties, callback) => { // Delete reference properties
                if (properties.length === 0) { return callback(null) }

                async.each(properties, (property, callback) => {
                    async.series([
                        (callback) => {
                            user.db.collection('property').updateOne({ _id: property._id }, { $set: { deleted: { at: new Date(), by: new objectId(user.id) } } }, callback)
                        },
                        (callback) => {
                            _h.aggregateEntity(user.db, property.entity, property.type, callback)
                        },
                    ], callback)
                }, callback)
            },
        ], (err) => {
            if (err) { return callback(null, _h.error(err)) }

            callback(null, _h.json({ deleted: true }))
        })
    })
}
