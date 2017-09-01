'use strict'

const _ = require('lodash')
const async = require('async')
const aws = require('aws-sdk')
const ObjectID = require('mongodb').ObjectID
const router = require('express').Router()


router.get('/:propertyId', (req, res, next) => {
    var connection
    var file

    if (!req.customer) { return next([400, 'No customer parameter']) }

    async.waterfall([
        (callback) => {
            req.app.locals.db(req.customer, callback)
        },
        (con, callback) => {
            connection = con
            connection.collection('property').findOne({ _id: new ObjectID(req.params.propertyId), deleted: { $exists: false } }, {_id: false, entity: true, filename: true, md5: true, s3: true, size: true }, callback)
        },
        (property, callback) => {
            if (!property) { return callback([404, 'File not found']) }

            file = property
            if (!file.s3) { return callback([404, 'File S3 not set']) }

            connection.collection('entity').findOne({ _id: file.entity, _deleted: { '$exists': false } }, { _id: false, _access: true }, callback)
        },
        (entity, callback) => {
            if (!entity) { return callback([404, 'Entity not found']) }

            let access = _.map(_.get(entity, '_access', []), s => s.toString())

            if (access.indexOf(req.user) !== -1 || _.get(entity, '_sharing.0.string', '') === 'public access is disabled for now') {
                callback(null, null)
            } else {
                return callback([403, 'Forbidden'])
            }
        },
        (r, callback) => {
            aws.config = new aws.Config()
            aws.config.accessKeyId = process.env.AWS_ACCESS_KEY_ID
            aws.config.secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY
            aws.config.region = process.env.AWS_REGION

            var s3 = new aws.S3()
            s3.getSignedUrl('getObject', { Bucket: process.env.AWS_S3_BUCKET, Key: file.s3, Expires: 10 }, callback)
        },
    ], (err, url) => {
        if (err) { return next(err) }

        res.respond({
            url: url,
            filename: file.filename,
            md5: file.md5,
            size: file.size
        })
    })
})



module.exports = router
