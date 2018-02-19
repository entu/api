'use strict'

console.log('Loading function')

if(process.env.NEW_RELIC_LICENSE_KEY) { require('newrelic') }

const _ = require('lodash')
const _h = require('./_helpers')
const async = require('async')
const aws = require('aws-sdk')
const objectId = require('mongodb').ObjectID



exports.handler = (event, context, callback) => {
    context.callbackWaitsForEmptyEventLoop = false

    _h.user(event, (err, user) => {
        if (err) { return callback(null, _h.error(err)) }
        if (!user.id) { return callback(null, _h.error([403, 'Forbidden'])) }

        const body = JSON.parse(event.body)

        if (!body) { return callback(null, _h.error([400, 'No data'])) }
        if (!_.isArray(body)) { return callback(null, _h.error([400, 'Data must be array'])) }
        if (body.length === 0) { return callback(null, _h.error([400, 'At least one property must be set'])) }

        var eId = new objectId(event.pathParameters.id)
        var pIds = []

        async.waterfall([
            (callback) => { // Get entity
                user.db.collection('entity').findOne({ _id: eId }, { _id: false, 'private._owner': true, 'private._editor': true }, callback)
            },
            (entity, callback) => { // Check rights and create _deleted property
                if (!entity) { return callback([404, 'Entity not found']) }

                const access = _.map(_.concat(_.get(entity, 'private._owner', []), _.get(entity, 'private._editor', [])), (s) => {
                    return s.reference.toString()
                })

                if (access.indexOf(user.id) === -1) { return callback([403, 'Forbidden']) }

                const created = {
                    at: new Date(),
                    by: new objectId(user.id)
                }
                let properties = []

                for (let i = 0; i < body.length; i++) {
                    let property = body[i]

                    if (!property.type) { return callback(null, _h.error([400, 'Property type not set'])) }
                    if (!property.type.match(/^[A-Za-z0-9\_]+$/)) { return callback(null, _h.error([400, 'Property type must be alphanumeric'])) }
                    if (property.type.substr(0, 1) === '_') { return callback(null, _h.error([400, 'Property type can\'t begin with _'])) }

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
                            user.db.collection('property').insertOne(property, callback)
                        },
                        (result, callback) => {
                            if (property.filename && property.size) {
                                aws.config = new aws.Config()

                                const s3 = new aws.S3()
                                const key = `${user.account}/${result.insertedId}`
                                const s3Params = {
                                    Bucket: process.env.S3_BUCKET,
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
                                        url: `https://${process.env.S3_BUCKET}.s3.amazonaws.com/${key}`,
                                        signedRequest: data
                                    })
                                })
                            } else {
                                return callback(null, { _id: result.insertedId })
                            }
                        },
                        (id, callback) => {
                            pIds.push(id)
                            _h.aggregateEntity(user.db, property.entity, property.type, callback)
                        }
                    ], callback)
                }, callback)
            },
            (callback) => {
                _h.aggregateEntity(user.db, eId, null, callback)
            },
        ], (err) => {
            if (err) { return callback(null, _h.error(err)) }

            callback(null, _h.json(pIds))
        })
    })
}
