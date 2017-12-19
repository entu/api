'use strict'

const _ = require('lodash')
const async = require('async')
const aws = require('aws-sdk')
const objectId = require('mongodb').ObjectID
const router = require('express').Router()

const entu = require('../helpers')



router.get('/', (req, res, next) => {
    if (!req.account) { return next([400, 'No account parameter']) }

    const props = _.compact(_.get(req, 'query.props', '').split(','))
    const sort = _.compact(_.get(req, 'query.sort', '').split(','))
    var findedEntities
    var count
    var filter = {}
    var fields = {}
    var sortFields = {}
    var limit = _.toSafeInteger(req.query.limit) || 100
    var skip = _.toSafeInteger(req.query.skip) || 0

    _.forIn(_.get(req, 'query'), (v, k) => {
        if (k.indexOf('.') !== -1) {
            const fieldArray = k.split('.')
            let field = _.get(fieldArray, 0)
            let type = _.get(fieldArray, 1)
            let operator = _.get(fieldArray, 2)
            let value

            switch(type) {
                case 'reference':
                    value = new objectId(v)
                    break
                case 'boolean':
                    value = v.toLowerCase() === 'true'
                    break
                case 'integer':
                    value = _.toNumber(v)
                    break
                case 'size':
                    value = _.toNumber(v)
                    break
                case 'decimal':
                    value = _.toNumber(v)
                    break
                case 'date':
                    value = new Date(v)
                    break
                case 'datetime':
                    value = new Date(v)
                    break
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
                _.set(filter, [`private.${field}.${type}`, `\$${operator}`], value)
            } else {
                filter[`private.${field}.${type}`] = value
            }
        }
    })

    if (req.user) {
        filter.access = { '$in': [new objectId(req.user), 'public'] }
    } else {
        filter.access = 'public'
    }

    if (props.length > 0) {
        _.forEach(props, (f) => {
            fields[`private.${f}`] = true
            fields[`public.${f}`] = true
        })
        fields['access'] = true
    }

    if (sort.length > 0) {
        _.forEach(sort, (f) => {
            if (f.substr(0, 1) === '-') {
                sortFields[`private.${f.substr(1)}`] = -1
            } else {
                sortFields[`private.${f}`] = 1
            }
        })
    } else {
        sortFields = { _id: 1 }
    }

    async.waterfall([
        (callback) => {
            req.app.locals.db(req.account, callback)
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

        res.json({
            count: count,
            entities: _.map(entities, (entity) => {
                const access = _.map(_.get(entity, 'access', []), (s) => {
                    return s.toString()
                })

                if (_.has(entity, 'private.entu_api_key')) {
                    _.get(entity, 'private.entu_api_key', []).forEach((k) => {
                        k.string = '***'
                    })
                }
                if (_.has(entity, 'public.entu_api_key')) {
                    _.get(entity, 'public.entu_api_key', []).forEach((k) => {
                        k.string = '***'
                    })
                }

                if (req.user && access.indexOf(req.user) !== -1) {
                    return Object.assign({ _id: entity._id }, _.get(entity, 'private', {}))
                } else if (access.indexOf('public') !== -1) {
                    return Object.assign({ _id: entity._id }, _.get(entity, 'public', {}))
                } else {
                    return { _id: entity._id }
                }
            })
        })
    })
})



router.post('/', (req, res, next) => {
    if (!req.account) { return next([400, 'No account parameter']) }
    if (!req.user) { return next([403, 'Forbidden']) }
    if (!req.body.type) { return next([400, 'No type']) }

    var connection
    var parent
    var eId
    var defaultParents = []
    var defaultValues = []
    var createdDt = new Date()

    async.waterfall([
        (callback) => {
            req.app.locals.db(req.account, callback)
        },
        (con, callback) => { // get entity type
            connection = con
            connection.collection('entity').findOne({ '_type.string': 'entity', 'key.string': req.body.type }, { default_parent: true }, callback)
        },
        (type, callback) => {
            if (!type) { return callback([404, 'Entity type not found']) }

            defaultParents = type.default_parent

            if (!req.body.parent) {
                return callback(null, null)
            }

            connection.collection('entity').findOne({ '_id': new objectId(req.body.parent) }, { _id: true, _type: true, _viewer: true, _expander: true, _editor: true, _owner: true }, (p, callback) => {
                parent = p

                if (!parent) { return callback([404, 'Parent entity not found']) }

                const access = _.map(_.concat(_.get(parent, '_owner', []), _.get(parent, '_editor', []), _.get(parent, '_expander', [])), (s) => {
                    return s.reference.toString()
                })

                if (access.indexOf(req.user) === -1) { return callback([403, 'Forbidden']) }

                connection.collection('entity').find({ _parent: type._id, '_type.string': 'property', 'default': {$exists: true } }, { _id: false, default: true }, callback)
            })
        },
        (defaults, callback) => {
            // defaultValues = _.map(defaults.default, 'reference')

            connection.collection('entity').insertOne({}, callback)
        },
        (entity, callback) => {
            eId = entity.insertedId

            let userId = new objectId(req.user)
            let properties = []

            _.forEach(defaultParents, (p) => {
                properties.push({ entity: eId, type: '_parent', reference: p.reference, created: { at: createdDt, by: userId } })
            })

            if (parent) {
                _.forEach(parent._viewer, (pViewer) => {
                    if (pViewer.reference === userId) { return }
                    properties.push({ entity: eId, type: '_viewer', reference: pViewer.reference, created: { at: createdDt, by: userId } })
                })
                _.forEach(parent._expander, (pExpander) => {
                    if (pExpander.reference === userId) { return }
                    properties.push({ entity: eId, type: '_expander', reference: pExpander.reference, created: { at: createdDt, by: userId } })
                })
                _.forEach(parent._editor, (pEditor) => {
                    if (pEditor.reference === userId) { return }
                    properties.push({ entity: eId, type: '_editor', reference: pEditor.reference, created: { at: createdDt, by: userId } })
                })
                _.forEach(parent._owner, (pOwner) => {
                    if (pOwner.reference === userId) { return }
                    properties.push({ entity: eId, type: '_owner', reference: pOwner.reference, created: { at: createdDt, by: userId } })
                })
                properties.push({ entity: eId, type: '_parent', reference: parent._id, created: { at: createdDt, by: userId } })
            }
            properties.push({ entity: eId, type: '_owner', reference: userId, created: { at: createdDt, by: userId } })

            properties.push({ entity: eId, type: '_type', string: req.body.type, created: { at: createdDt, by: userId } })
            properties.push({ entity: eId, type: '_created', boolean: true, created: { at: createdDt, by: userId } })

            connection.collection('property').insertMany(properties, callback)
        },
        (r, callback) => { // Aggregate entity
            entu.aggregateEntity(req, eId, null, callback)
        },
    ], (err) => {
        if (err) { return next(err) }

        res.json({ _id: eId })
    })
})



router.get('/:entityId', (req, res, next) => {
    if (!req.account) { return next([400, 'No account parameter']) }

    async.waterfall([
        (callback) => {
            req.app.locals.db(req.account, callback)
        },
        (connection, callback) => {
            const props = _.compact(_.get(req, 'query.props', '').split(','))
            let config = {}

            if (props.length > 0) {
                _.forEach(props, (f) => {
                    _.set(config, ['fields', `private.${f}`], true)
                })
                _.set(config, 'fields.access', true)
            }

            connection.collection('entity').findOne({ _id: new objectId(req.params.entityId) }, config, callback)
        },
    ], (err, entity) => {
        if (err) { return next(err) }

        if (!entity) { return next([404, 'Entity not found']) }

        if (_.has(entity, 'private.entu_api_key')) {
            _.get(entity, 'private.entu_api_key', []).forEach((k) => {
                k.string = '***'
            })
        }
        if (_.has(entity, 'public.entu_api_key')) {
            _.get(entity, 'public.entu_api_key', []).forEach((k) => {
                k.string = '***'
            })
        }

        const access = _.map(_.get(entity, 'access', []), (s) => {
            return s.toString()
        })

        if (req.user && access.indexOf(req.user) !== -1) {
            return res.json(Object.assign({ _id: entity._id }, _.get(entity, 'private', {})))
        } else if (access.indexOf('public') !== -1) {
            return res.json(Object.assign({ _id: entity._id }, _.get(entity, 'public', {})))
        } else {
            return next([403, 'Forbidden'])
        }
    })
})



router.post('/:entityId', (req, res, next) => {
    if (!req.account) { return next([400, 'No account parameter']) }
    if (!req.user) { return next([403, 'Forbidden']) }
    if (!_.isArray(req.body)) { return next([400, 'Data must be array']) }
    if (req.body.length === 0) { return next([400, 'At least one property must be set']) }

    var eId = new objectId(req.params.entityId)
    var connection
    var pIds = []

    async.waterfall([
        (callback) => {
            req.app.locals.db(req.account, callback)
        },
        (con, callback) => { // Get entity
            connection = con
            connection.collection('entity').findOne({ _id: eId }, { _id: false, _owner: true, _editor: true }, callback)
        },
        (entity, callback) => { // Check rights and create _deleted property
            if (!entity) { return callback([404, 'Entity not found']) }

            const access = _.map(_.concat(_.get(entity, '_owner', []), _.get(entity, '_editor', [])), (s) => {
                return s.reference.toString()
            })

            if (access.indexOf(req.user) === -1) { return callback([403, 'Forbidden']) }

            const created = {
                at: new Date(),
                by: new objectId(req.user)
            }
            let properties = []

            for (let i = 0; i < req.body.length; i++) {
                let property = req.body[i]

                if (!property.type) { return next([400, 'Property type not set']) }
                if (!property.type.match(/^[A-Za-z0-9\_]+$/)) { return next([400, 'Property type must be alphanumeric']) }
                if (property.type.substr(0, 1) === '_') { return next([400, 'Property type can\'t begin with _']) }

                if (property.reference) { property.reference = new objectId(property.reference) }
                if (property.date) { property.date = new Date(property.date) }
                if (property.datetime) { property.datetime = new Date(property.datetime) }

                property.entity = eId
                property.created = created
                properties.push(property)
            }

            async.each(properties, (property, callback) => {
                async.waterfall([
                    (callback) => {
                        connection.collection('property').insertOne(property, callback)
                    },
                    (result, callback) => {
                        if (property.filename && property.size) {
                            aws.config = new aws.Config()
                            aws.config.accessKeyId = process.env.AWS_ACCESS_KEY_ID
                            aws.config.secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY
                            aws.config.region = process.env.AWS_REGION

                            const s3 = new aws.S3()
                            const key = `${req.account}/${result.insertedId}`
                            const s3Params = {
                                Bucket: process.env.AWS_S3_BUCKET,
                                Key: key,
                                Expires: 60,
                                ContentType: property.type,
                                ACL: 'private',
                                ContentDisposition: `inline;filename="${property.filename.replace('"', '\"')}"`,
                                ServerSideEncryption: 'AES256'
                            }

                            s3.getSignedUrl('putObject', s3Params, (err, data) => {
                                if (err) { return callback(err) }
                                return callback(null, {
                                    _id: result.insertedId,
                                    url: `https://${process.env.AWS_S3_BUCKET}.s3.amazonaws.com/${key}`,
                                    signedRequest: data
                                })
                            })
                        } else {
                            return callback(null, { _id: result.insertedId })
                        }
                    },
                    (id, callback) => {
                        pIds.push(id)
                        entu.aggregateEntity(req, property.entity, property.type, callback)
                    }
                ], callback)
            }, callback)
        },
        (callback) => {
            entu.aggregateEntity(req, eId, null, callback)
        },
    ], (err) => {
        if (err) { return next(err) }

        res.json(pIds)
    })
})



router.delete('/:entityId', (req, res, next) => {
    if (!req.account) { return next([400, 'No account parameter']) }
    if (!req.user) { return next([403, 'Forbidden']) }

    var eId = new objectId(req.params.entityId)
    var connection

    async.waterfall([
        (callback) => {
            req.app.locals.db(req.account, callback)
        },
        (con, callback) => { // Get entity
            connection = con
            connection.collection('entity').findOne({ _id: eId }, { _id: false, _owner: true }, callback)
        },
        (entity, callback) => { // Check rights and create _deleted property
            if (!entity) { return callback([404, 'Entity not found']) }

            const access = _.map(_.get(entity, '_owner', []), (s) => {
                return s.reference.toString()
            })

            if (access.indexOf(req.user) === -1) { return callback([403, 'Forbidden']) }

            connection.collection('property').insertOne({ entity: eId, type: '_deleted', boolean: true, created: { at: new Date(), by: new objectId(req.user) } }, callback)
        },
        (r, callback) => { // Aggregate entity
            entu.aggregateEntity(req, eId, '_deleted', callback)
        },
        (r, callback) => { // Get reference properties
            connection.collection('property').find({ reference: eId, deleted: { $exists: false } }, { entity: true, type: true }).toArray(callback)
        },
        (properties, callback) => { // Delete reference properties
            if (properties.length === 0) { return callback(null) }

            async.each(properties, (property, callback) => {
                async.series([
                    (callback) => {
                        connection.collection('property').updateOne({ _id: property._id }, { $set: { deleted: { at: new Date(), by: new objectId(req.user) } } }, callback)
                    },
                    (callback) => {
                        entu.aggregateEntity(req, property.entity, property.type, callback)
                    },
                ], callback)
            }, callback)
        },
    ], (err) => {
        if (err) { return next(err) }

        res.json({ deleted: true })
    })
})



module.exports = router
