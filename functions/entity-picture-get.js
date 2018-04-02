'use strict'

console.log('Loading function')

const _ = require('lodash')
const _h = require('./_helpers')
const async = require('async')
const aws = require('aws-sdk')
const crypto = require('crypto')
const fs = require('fs')
const https = require('https')
const path = require('path')


const sql = fs.readFileSync(path.resolve(__dirname, 'sql', 'get_entity_picture.sql'), 'utf8')

exports.handler = (event, context, callback) => {
    context.callbackWaitsForEmptyEventLoop = false

    if(!_.get(event, 'pathParameters.db') || !_.get(event, 'pathParameters.id')) {
        return callback(_h.error([400, 'Bad request']))
    }

    const db = event.pathParameters.db
    const entityId = event.pathParameters.id

    var cookie
    var sessionKey
    var connection
    var userEmail

    try {
        cookie = _.get(event,'headers.cookie') || _.get(event,'headers.Cookie')
        sessionKey = cookie.split(';').map(x => x.trim()).filter(x => x.startsWith('session='))[0].substr(8)
    } catch (e) {
        // No session cookie
    }

    async.waterfall([
        (callback) => {
            _h.db('entu', callback)
        },
        (mongoConn, callback) => {
            if (sessionKey) {
                mongoConn.collection('session').findOne({ key: sessionKey }, { fields: { _id: false, 'user.email': true } }, callback)
            } else {
                callback(null, null)
            }
        },
        (sess, callback) => {
            _h.mysqlDb(db).query(sql, [entityId, entityId, entityId, _.get(sess, 'user.email', '__PUBLIC__')], (err, data) => {
                if (err) { return callback(err) }
                callback(null, data[0])
            })
        },
        (file, callback) => {
            if(!file) {
                let md5 = crypto.createHash('md5').update(entityId).digest('hex')
                return callback(null, `https://secure.gravatar.com/avatar/${md5}?d=identicon&s=150`)
            }

            if(!file.s3) {
                let md5 = crypto.createHash('md5').update(file.id).digest('hex')
                let d = file.type === 'person' ? 'robohash' : 'identicon'
                return callback(null, `https://secure.gravatar.com/avatar/${md5}?d=${d}&s=150`)
            }

            let conf
            if (process.env.S3_ENDPOINT) {
                conf = { endpoint: process.env.S3_ENDPOINT, s3BucketEndpoint: true }
            }

            aws.config = new aws.Config()
            const s3 = new aws.S3(conf)
            s3.getSignedUrl('getObject', { Bucket: process.env.S3_BUCKET, Key: file.s3, Expires: 10 }, callback)
        },
    ], (err, url) => {
        if (err) { return callback(null, _h.error(err)) }
        if(!url) { return callback(null, _h.error([404, 'Not found'])) }

        callback(null, {
            statusCode: 302,
            headers: { 'Location' : url },
            body: null
        })
    })
}
