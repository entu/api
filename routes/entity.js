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
            let filter = {}
            let fields = {}
            let limit = _.toSafeInteger(req.query.limit) || 100

            if(req.query.def) { filter['_definition.string'] = req.query.def }
            filter._access = new ObjectID(req.user)

            if (props.length > 0) {
                _.forEach(props, (f) => {
                    _.set(fields, f, true)
                })
                _.set(fields, '_access', true)
            }

            connection.collection('entity').find(filter, fields).limit(limit).toArray(callback)
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

            connection.collection('entity').findOne({ _id: new mongo.ObjectID(req.params.entityId) }, config, callback)
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



module.exports = router
