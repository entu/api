'use strict'

const _ = require('lodash')
const async = require('async')
const aws = require('aws-sdk')
const ObjectID = require('mongodb').ObjectID
const router = require('express').Router()



router.get('/:propertyId', (req, res, next) => {
    if (!req.customer) { return next([400, 'No customer parameter']) }

    var connection
    var property

    async.waterfall([
        (callback) => {
            req.app.locals.db(req.customer, callback)
        },
        (con, callback) => {
            connection = con
            connection.collection('property').findOne({ _id: new ObjectID(req.params.propertyId), deleted: { $exists: false } }, callback)
        },
        (prop, callback) => {
            if (!prop) { return callback([404, 'Property not found']) }

            property = prop

            connection.collection('entity').findOne({ _id: property.entity }, { _id: false, _access: true }, callback)
        },
        (entity, callback) => {
            if (!entity) { return callback([404, 'Entity not found']) }

            let access = _.map(_.get(entity, '_access', []), s => s.toString())

            if (access.indexOf(req.user) === -1) { return callback([403, 'Forbidden']) }

            if (property.s3) {
                aws.config = new aws.Config()
                aws.config.accessKeyId = process.env.AWS_ACCESS_KEY_ID
                aws.config.secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY
                aws.config.region = process.env.AWS_REGION

                var s3 = new aws.S3()
                s3.getSignedUrl('getObject', { Bucket: process.env.AWS_S3_BUCKET, Key: property.s3, Expires: 10 }, callback)
            } else {
                callback(null, null)
            }
        },
    ], (err, url) => {
        if (err) { return next(err) }

        if (url) {
            property.url = url
            _.unset(property, 's3')
        }

        if (_.get(property, 'url') && _.has(req, 'query.download')) {
            res.redirect(_.get(property, 'url'))
        } else {
            res.respond(property)
        }
    })
})



router.delete('/:propertyId', (req, res, next) => {
    if (!req.customer) { return next([400, 'No customer parameter']) }

    var connection
    var property

    async.waterfall([
        (callback) => {
            req.app.locals.db(req.customer, callback)
        },
        (con, callback) => {
            connection = con
            connection.collection('property').findOne({ _id: new ObjectID(req.params.propertyId), deleted: { $exists: false } }, {_id: false, entity: true, type: true }, callback)
        },
        (prop, callback) => {
            if (!prop) { return callback([404, 'Property not found']) }

            property = prop

            connection.collection('entity').findOne({ _id: property.entity }, { _id: false, _access: true }, callback)
        },
        (entity, callback) => {
            if (!entity) { return callback([404, 'Entity not found']) }

            let access = _.map(_.concat(_.get(entity, '_owner', []), _.get(entity, '_editor', [])), s => s.reference.toString())

            if (access.indexOf(req.user) === -1) { return next([403, 'Forbidden']) }

            connection.collection('property').updateOne({ _id: property._id }, { $set: { deleted: { at: new Date(), by: new ObjectID(req.user) } } }, callback)
        },
        (r, callback) => { // Aggregate entity
            entu.aggregateEntity(req, property.entity, property.type, callback)
        },
    ], (err, url) => {
        if (err) { return next(err) }

        res.respond(true)
    })
})



module.exports = router
