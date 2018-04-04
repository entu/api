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
                user.db.collection('entity').aggregate([{
                    $group: {
                        _id: { $gt: ['$private._deleted', null] },
                        count: { $sum: 1 }
                    }
                }]).toArray(callback)
            },

            properties: (callback) => {
                user.db.collection('property').aggregate([{
                    $group: {
                        _id: { $gt: ['$deleted', null] },
                        count: { $sum: 1 }
                    }
                }]).toArray(callback)
            },

            files: (callback) => {
                user.db.collection('property').aggregate([
                    {
                        $match: {
                            size: { $exists: true }
                        }
                    }, {
                        $group: {
                            _id: { $gt: ['$deleted', null] },
                            count: { $sum: 1 },
                            size: { $sum: '$size' }
                        }
                    }
                ]).toArray(callback)
            }
        }, (err, stats) => {
            if (err) { return callback(null, _h.error(err)) }

            callback(null, _h.json({
                entities: _.get(stats.entities.filter(e => e._id === false), '0.count', 0),
                deletedEntities: _.get(stats.entities.filter(e => e._id === true), '0.count', 0),
                properties: _.get(stats.properties.filter(e => e._id === false), '0.count', 0),
                deletedProperties: _.get(stats.properties.filter(e => e._id === true), '0.count', 0),
                files: _.get(stats.files.filter(e => e._id === false), '0.count', 0),
                filesSize: _.get(stats.files.filter(e => e._id === false), '0.size', 0),
                deletedFiles: _.get(stats.files.filter(e => e._id === true), '0.count', 0),
                deletedFilesSize: _.get(stats.files.filter(e => e._id === true), '0.size', 0),
                dbSize: stats.stats.dataSize + stats.stats.indexSize
            }))
        })
    })
}
