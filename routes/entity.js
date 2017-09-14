'use strict'

const _ = require('lodash')
const async = require('async')
const ObjectID = require('mongodb').ObjectID
const router = require('express').Router()

const entu = require('../helpers/entu')



router.get('/', (req, res, next) => {
    if (!req.customer) { return next([400, 'No customer parameter']) }

    let props = _.compact(_.get(req, 'query.props', '').split(','))
    let sort = _.compact(_.get(req, 'query.sort', '').split(','))
    var findedEntities
    var count
    var filter = {}
    var fields = {}
    var sortFields = {}
    var limit = _.toSafeInteger(req.query.limit) || 100
    var skip = _.toSafeInteger(req.query.skip) || 0

    _.forIn(_.get(req, 'query'), (v, k) => {
        if (k.indexOf('.') !== -1) {
            let fieldArray = k.split('.')
            let field = _.get(fieldArray, 0)
            let type = _.get(fieldArray, 1)
            let operator = _.get(fieldArray, 2)
            let value

            switch(type) {
                case 'reference':
                    value = new ObjectID(v)
                    break;
                case 'boolean':
                    value = v.toLowerCase() === 'true'
                    break;
                case 'integer':
                    value = _.toNumber(v)
                    break;
                case 'size':
                    value = _.toNumber(v)
                    break;
                case 'decimal':
                    value = _.toNumber(v)
                    break;
                case 'date':
                    value = new Date(v)
                    break;
                case 'datetime':
                    value = new Date(v)
                    break;
                default:
                    if (operator === 'regex' && v.indexOf('/') > -1) {
                        value = new RegExp(v.split('/')[1], v.split('/')[2])
                    } else if (operator === 'exists') {
                        value = v.toLowerCase() === 'true'
                    } else {
                        value = v
                    }
            }

            if (['gt', 'gte', 'lt', 'lte', 'ne', 'regex', 'exists'].indexOf(operator) !== -1) {
                _.set(filter, [field + '.' + type, '$' + operator], value)
            } else {
                filter[field + '.' + type] = value
            }
        }
    })

    filter._access = new ObjectID(req.user)

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

    async.waterfall([
        (callback) => {
            req.app.locals.db(req.customer, callback)
        },
        (connection, callback) => {
            connection.collection('entity').find(filter, fields, callback)
        },
        (f, callback) => {
            findedEntities = f
            findedEntities.count(callback)
        },
        (c, callback) => {
            count = c
            findedEntities.sort(sortFields).skip(skip).limit(limit).toArray(callback)
        },
    ], (err, entities) => {
        if (err) { return next(err) }

        res.respond({
            count: count,
            entities: _.map(entities, (entity) => {
                _.unset(entity, '_mid')
                _.unset(entity, '_access')
                return entity
            })
        })

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

            connection.collection('entity').findOne({ _id: new ObjectID(req.params.entityId) }, config, callback)
        },
    ], (err, entity) => {
        if (err) { return next(err) }

        if (!entity) { return next([404, 'Entity not found']) }

        let access = _.map(_.get(entity, '_access', []), s =>  s.toString())

        if (access.indexOf(req.user) !== -1 || _.get(entity, '_sharing.0.string', '') === 'public access is disabled for now') {
            _.unset(entity, '_mid')
            _.unset(entity, '_access')
            res.respond(entity)
        } else {
            return next([403, 'Forbidden'])
        }
    })
})



router.delete('/:entityId', (req, res, next) => {
    if (!req.customer) { return next([400, 'No customer parameter']) }

    var eId = new ObjectID(req.params.entityId)
    var connection

    async.waterfall([
        (callback) => {
            req.app.locals.db(req.customer, callback)
        },
        (con, callback) => { // Get entity
            connection = con
            connection.collection('entity').findOne({ _id: eId }, { _owner: true }, callback)
        },
        (entity, callback) => { // Check rights and create _deleted property
            if (!entity) { return next([404, 'Entity not found']) }

            let access = _.map(_.get(entity, '_owner', []), s => s.reference.toString())

            if (access.indexOf(req.user) === -1) {
                return next([403, 'Forbidden'])
            }

            connection.collection('property').insertOne({ entity: eId, definition: '_deleted', boolean: true, created: { at: new Date(), by: new ObjectID(req.user) } }, callback)
        },
        (r, callback) => { // Aggregate entity
            entu.aggregateEntity(req, eId, '_deleted', callback)
        },
        (r, callback) => { // Get reference properties
            connection.collection('property').find({ reference: eId, deleted: { '$exists': false } }, { _id: true, entity: true, definition: true }).toArray(callback)
        },
        (properties, callback) => { // Delete reference properties
            if (properties.length === 0) { return callback(null) }

            async.each(properties, (property, callback) => {
                async.series([
                    (callback) => {
                        connection.collection('property').updateOne({ _id: property._id }, { $set: { deleted: { at: new Date(), by: new ObjectID(req.user) } } }, callback)
                    },
                    (callback) => {
                        entu.aggregateEntity(req, property.entity, property.definition, callback)
                    },
                ], callback)
            }, callback)
        },
    ], (err, entity) => {
        if (err) { return next(err) }

        res.respond(true)
    })
})



module.exports = router
