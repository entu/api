'use strict'

const _ = require('lodash')
const async = require('async')
const router = require('express').Router()

const entu = require('../helpers/entu')



router.get('/', function (req, res, next) {
    if (!req.customer) { return next([400, 'No customer parameter']) }

    async.waterfall([
        function (callback) {
            entu.dbConnection(req.customer, callback)
        },
        function (connection, callback) {
            let props = _.compact(_.get(req, 'query.props', '').split(','))
            let filter = {}
            let fields = {}
            let limit = _.toSafeInteger(req.query.limit) || 100

            if(req.query.def) { filter['_definition.string'] = req.query.def }
            filter._access = entu.objectId(req.user)

            if (props.length > 0) {
                _.forEach(props, function (f) {
                    _.set(fields, f, true)
                })
                _.set(fields, '_access', true)
            }

            connection.collection('entity').find(filter, fields).limit(limit).toArray(callback)
        },
    ], function (err, entities) {
        if (err) { return next(err) }

        res.respond(_.map(entities, function (entity) {
            delete entity._mid
            delete entity._access
            return entity
        }))

    })
})



router.get('/:entityId', function (req, res, next) {
    var entityId = entu.objectId(req.params.entityId)

    if (!entityId) { return next([422, 'Invalid Entity ID']) }
    if (!req.customer) { return next([400, 'No customer parameter']) }

    async.waterfall([
        function (callback) {
            entu.dbConnection(req.customer, callback)
        },
        function (connection, callback) {
            let props = _.compact(_.get(req, 'query.props', '').split(','))
            let config = {}

            if (props.length > 0) {
                _.forEach(props, function (f) {
                    _.set(config, ['fields', f], true)
                })
                _.set(config, 'fields._access', true)
            }

            connection.collection('entity').findOne({ _id: entityId }, config, callback)
        },
    ], function (err, entity) {
        if (err) { return next(err) }

        if (!entity) { return next([404, 'Entity not found']) }

        let access = _.map(_.get(entity, '_access', []), function (s) {
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



module.exports = router
