'use strict'

const _ = require('lodash')
const async = require('async')
const ObjectID = require('mongodb').ObjectID
const router = require('express').Router()


router.delete('/:propertyId', (req, res, next) => {
    if (!req.customer) { return next([400, 'No customer parameter']) }

    var connection
    var file

    async.waterfall([
        (callback) => {
            req.app.locals.db(req.customer, callback)
        },
        (con, callback) => {
            connection = con
            connection.collection('property').findOne({ _id: new ObjectID(req.params.propertyId), deleted: { $exists: false } }, {_id: false, entity: true, definition: true }, callback)
        },
        (property, callback) => {
            if (!property) { return callback([404, 'Property not found']) }

            file = property

            connection.collection('entity').findOne({ _id: file.entity, _deleted: { '$exists': false } }, { _id: false, _access: true }, callback)
        },
        (entity, callback) => {
            if (!entity) { return callback([404, 'Entity not found']) }

            let access = _.map(_.concat(_.get(entity, '_owner', []), _.get(entity, '_editor', [])), s => s.reference.toString())

            if (access.indexOf(req.user) === -1) {
                return next([403, 'Forbidden'])
            }

            connection.collection('property').updateOne({ _id: property._id }, { $set: { deleted: { at: new Date(), by: new ObjectID(req.user) } } }, callback)
        },
        (r, callback) => { // Aggregate entity
            entu.aggregateEntity(req, file.entity, file.definition, callback)
        },
    ], (err, url) => {
        if (err) { return next(err) }

        res.respond(true)
    })
})



module.exports = router
