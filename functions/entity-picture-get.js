'use strict'

console.log('Loading function')

const _ = require('lodash')
const _h = require('./_helpers')
const async = require('async')
const fs = require('fs')
const path = require('path')



const sql = fs.readFileSync(path.resolve(__dirname, 'sql', 'get_entity_picture.sql'), 'utf8')

exports.handler = (event, context, callback) => {
    context.callbackWaitsForEmptyEventLoop = false

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
        return callback(null, _h.error([403, 'Forbidden']))
    }

    if (!sessionKey) {
        return callback(null, _h.error([403, 'Forbidden']))
    }

    async.waterfall([
        (callback) => {
            _h.db('entu', callback)
        },
        (mongoConn, callback) => {
            mongoConn.collection('session').findOne({ key: sessionKey }, { fields: { _id: false, 'user.email': true } }, callback)
        },
        (sess, callback) => {
            if(_.get(sess, 'user.email')) {
                callback(null, sess.user.email)
            } else {
                callback([403, 'Forbidden'])
            }
        },
        (email, callback) => {
            _h.mysqlDb(db).query(sql, [entityId, entityId, email], (err, data) => {
                console.log(data)
                console.log(err)

                callback(null, data)
            })
        },
    ], (err, accounts) => {
        if (err) { return callback(null, _h.error(err)) }

        callback(null, _h.json({ x: accounts }))
    })
}
