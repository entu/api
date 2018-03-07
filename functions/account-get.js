'use strict'

console.log('Loading function')

const _ = require('lodash')
const _h = require('./_helpers')
const async = require('async')



exports.handler = (event, context, callback) => {
    context.callbackWaitsForEmptyEventLoop = false

    _h.user(event, (err, user) => {
        if (err) { return callback(null, _h.error(err)) }

        async.parallel({
            stats: (callback) => {
                user.db.stats(callback)
            },

            entities: (callback) => {
                user.db.collection('entity').count(callback)
            },
            deletedEntities: (callback) => {
                const aggregate = [
                    { $match: { type: '_deleted', deleted: { $exists: false } } },
                    { $group: { _id: '$entity', count: { $sum: 1 } } },
                    { $group: { _id: null, count: { $sum: 1 } } }
                ]
                user.db.collection('property').aggregate(aggregate, (err, count) => {
                    if (err) { return callback(err) }

                    return callback(null, _.get(count, '0.count', 0))
                })
            },

            properties: (callback) => {
                user.db.collection('property').find({ deleted: { $exists: false } }).count(callback)
            },
            deletedProperties: (callback) => {
                user.db.collection('property').find({ deleted: { $exists: true } }).count(callback)
            },

            files: (callback) => {
                const aggregate = [
                    { $match: { size: { $exists: true }, deleted: { $exists: false } } },
                    { $group: {_id: null, count: { $sum: 1 }, size: { $sum: '$size' } } },
                    { $project: { _id: false } }
                ]
                user.db.collection('property').aggregate(aggregate, (err, count) => {
                    if (err) { return callback(err) }

                    return callback(null, _.get(count, '0', {}))
                })
            },
            deletedFiles: (callback) => {
                const aggregate = [
                    { $match: { size: { $exists: true }, deleted: { $exists: true } } },
                    { $group: {_id: null, count: { $sum: 1 }, size: { $sum: '$size' } } },
                    { $project: { _id: false } }
                ]
                user.db.collection('property').aggregate(aggregate, (err, count) => {
                    if (err) { return callback(err) }

                    return callback(null, _.get(count, '0', {}))
                })
            }
        }, (err, stats) => {
            if (err) { return callback(null, _h.error(err)) }

            callback(null, _h.json({
                entities: stats.entities,
                deletedEntities: stats.deletedEntities,
                properties: stats.properties,
                deletedProperties: stats.deletedProperties,
                files: stats.files.count,
                filesSize: stats.files.size,
                deletedFiles: stats.deletedFiles.count,
                deletedFilesSize: stats.deletedFiles.size,
                dbSize: stats.stats.dataSize + stats.stats.indexSize
            }))
        })
    })
}
