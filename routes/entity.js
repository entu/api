'use strict'

const _ = require('lodash')
const async = require('async')
const ObjectID = require('mongodb').ObjectID
const router = require('express').Router()



router.get('/', (req, res, next) => {
    if (!req.customer) { return next([400, 'No customer parameter']) }

    async.waterfall([
        (callback) => {
            req.app.locals.db(req.customer, callback)
        },
        (connection, callback) => {
            let props = _.compact(_.get(req, 'query.props', '').split(','))
            let sort = _.compact(_.get(req, 'query.sort', '').split(','))
            let filter = {}
            let fields = {}
            let sortFields = {}
            let limit = _.toSafeInteger(req.query.limit) || 100
            let skip = _.toSafeInteger(req.query.skip) || 0

            if(req.query.def) { filter['_definition.string'] = req.query.def }
            filter._access = new ObjectID(req.user)
            filter._deleted = { $exists: false }

            if (props.length > 0) {
                _.forEach(props, (f) => {
                    fields[f] = true
                })
                _.set(fields, '_access', true)
            }

            if (sort.length > 0) {
                _.forEach(sort, (f) => {
                    if (f.substr(0, 1) === '-') {
                        sortFields[f.substr(1)] = -1
                    } else {
                        sortFields[f] = 1
                    }
                })
            } else {
                sortFields = { _id: 1 }
            }

            connection.collection('entity').find(filter, fields).sort({ _id: 1 }).limit(limit).skip(limit).toArray(callback)
        },
    ], (err, entities) => {
        if (err) { return next(err) }

        res.respond(_.map(entities, (entity) => {
            delete entity._mid
            delete entity._access
            return entity
        }))

    })
})



router.get('/:entityId', (req, res, next) => {
    if (!req.customer) { return next([400, 'No customer parameter']) }

    async.waterfall([
        (callback) => {
            req.app.locals.db(req.customer, callback)
        },
        (connection, callback) => {
            let props = _.compact(_.get(req, 'query.props', '').split(','))
            let config = {}

            if (props.length > 0) {
                _.forEach(props, (f) => {
                    _.set(config, ['fields', f], true)
                })
                _.set(config, 'fields._access', true)
            }

            connection.collection('entity').findOne({ _id: new ObjectID(req.params.entityId), _deleted: { $exists: false } }, config, callback)
        },
    ], (err, entity) => {
        if (err) { return next(err) }

        if (!entity) { return next([404, 'Entity not found']) }

        let access = _.map(_.get(entity, '_access', []), (s) => {
            return s.toString()
        })

        if (access.indexOf(req.user) !== -1 || _.get(entity, '_sharing.0.string', '') === 'public access is disabled for now') {
            delete entity._mid
            delete entity._access
            res.respond(entity)
        } else {
            return next([403, 'Forbidden'])
        }
    })
})



router.delete('/:entityId', (req, res, next) => {
    if (!req.customer) { return next([400, 'No customer parameter']) }

    var connection
    var entity

    async.waterfall([
        (callback) => {
            req.app.locals.db(req.customer, callback)
        },
        (con, callback) => {
            connection = con
            connection.collection('entity').findOne({ _id: new ObjectID(req.params.entityId), _deleted: { $exists: false } }, { _owner: true }, callback)
        },
        (e, callback) => {
            if (!e) { return next([404, 'Entity not found']) }

            entity = e

            let access = _.map(_.get(entity, '_owner', []), (s) => {
                return s.reference.toString()
            })

            if (access.indexOf(req.user) === -1) {
                return next([403, 'Forbidden'])
            }

            connection.collection('property').insertOne({ entity: entity._id, definition: '_deleted', boolean: true, created: { at: new Date(), by: new ObjectID(req.user) } }, callback)
        },
        (property, callback) => {
            connection.collection('entity').updateOne({ _id: entity._id }, { $set: { _deleted: [{ _id: property.insertedId, boolean: true }] } }, callback)
        },
    ], (err, entity) => {
        if (err) { return next(err) }

        res.respond(true)
    })
})



module.exports = router
