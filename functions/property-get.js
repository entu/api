'use strict'

console.log('Loading function')

const _ = require('lodash')
const _h = require('./_helpers')
const async = require('async')
const aws = require('aws-sdk')
const objectId = require('mongodb').ObjectID



exports.handler = (event, context, callback) => {
    context.callbackWaitsForEmptyEventLoop = false

    _h.user(event, (err, user) => {
        if (err) { return callback(null, _h.error(err)) }

        var connection
        var property

        async.waterfall([
            (callback) => {
                user.db.collection('property').findOne({ _id: new objectId(event.pathParameters.id), deleted: { $exists: false } }, callback)
            },
            (prop, callback) => {
                if (!prop) { return callback([404, 'Property not found']) }

                property = prop

                user.db.collection('entity').findOne({ _id: property.entity }, { _id: false, access: true }, callback)
            },
            (entity, callback) => {
                if (!entity) { return callback([404, 'Entity not found']) }

                const access = _.map(_.get(entity, 'access', []), (s) => {
                    return s.toString()
                })

                if (access.indexOf(user.id) === -1) { return callback([403, 'Forbidden']) }

                if (property.s3) {
                    let conf
                    if (process.env.S3_ENDPOINT) {
                        conf = { endpoint: process.env.S3_ENDPOINT, s3BucketEndpoint: true }
                    }

                    aws.config = new aws.Config()
                    const s3 = new aws.S3(conf)
                    s3.getSignedUrl('getObject', { Bucket: process.env.S3_BUCKET, Key: property.s3, Expires: 10 }, callback)
                } else {
                    return callback(null, null)
                }
            }
        ], (err, url) => {
            if (err) { return callback(null, _h.error(err)) }

            if (url) {
                property.url = url
                _.unset(property, 's3')
            }

            if (property.type === 'entu_api_key') {
                property.string = '***'
            }

            if (_.get(property, 'url') && _.has(event, 'queryStringParameters.download')) {
                callback(null, {
                    statusCode: 301,
                    headers: {
                        'Location' : _.get(property, 'url')
                    },
                    body: null
                })
            } else {
                callback(null, _h.json(property))
            }
        })
    })
}
