'use strict'

const _ = require('lodash')
const async = require('async')
const router = require('express').Router()



router.get('/', (req, res, next) => {
    if (!req.account) { return next([400, 'No account parameter']) }

    req.app.locals.db(req.account, (err, connection) => {
        if (err) { return next(err) }

        async.parallel({
            entities: (callback) => {
                connection.collection('entity').count(callback)
            },
            deletedEntities: (callback) => {
                let aggregate = [
                    { $match: { type: '_deleted', deleted: { $exists: false } } },
                    { $group: { _id: '$entity', count: { $sum: 1 } } },
                    { $group: { _id: null, count: { $sum: 1 } } }
                ]
                connection.collection('property').aggregate(aggregate, (err, count) => {
                    if (err) { return callback(err) }

                    callback(null, _.get(count, '0.count', 0))
                })
            },

            properties: (callback) => {
                connection.collection('property').find({ deleted: { $exists: false } }).count(callback)
            },
            deletedProperties: (callback) => {
                connection.collection('property').find({ deleted: { $exists: true } }).count(callback)
            },

            files: (callback) => {
                let aggregate = [
                    { $match: { size: { $exists: true }, deleted: { $exists: false } } },
                    { $group: {_id: null, count: { $sum: 1 }, size: { $sum: '$size' } } },
                    { $project: { _id: false } }
                ]
                connection.collection('property').aggregate(aggregate, (err, count) => {
                    if (err) { return callback(err) }

                    callback(null, _.get(count, '0', {}))
                })
            },
            deletedFiles: (callback) => {
                let aggregate = [
                    { $match: { size: { $exists: true }, deleted: { $exists: true } } },
                    { $group: {_id: null, count: { $sum: 1 }, size: { $sum: '$size' } } },
                    { $project: { _id: false } }
                ]
                connection.collection('property').aggregate(aggregate, (err, count) => {
                    if (err) { return callback(err) }

                    callback(null, _.get(count, '0', {}))
                })
            },
        }, (err, stats) => {
            if (err) { return next(err) }

            res.json({
                account: req.account,
                stats: {
                    entities: stats.entities,
                    deletedEntities: stats.deletedEntities,
                    properties: stats.properties,
                    deletedProperties: stats.deletedProperties,
                    files: stats.files.count,
                    filesSize: stats.files.size,
                    deletedFiles: stats.deletedFiles.count,
                    deletedFilesSize: stats.deletedFiles.size
                }
            })

        })
    })
})



module.exports = router
