'use strict'

console.log('Loading function')

if(process.env.NEW_RELIC_LICENSE_KEY) { require('newrelic') }

const _ = require('lodash')
const _h = require('./_helpers')
const async = require('async')
const jwt = require('jsonwebtoken')
const objectId = require('mongodb').ObjectID


const mongoDbSystemDbs = ['admin', 'config', 'local']


exports.handler = (event, context, callback) => {
    context.callbackWaitsForEmptyEventLoop = false

    const authHeaderParts = _.get(event, 'headers.Authorization', '').split(' ')

    if(authHeaderParts.length !== 2 || authHeaderParts[0].toLowerCase() !== 'bearer') { return callback(null, _h.error([400, 'No key'])) }

    const key = authHeaderParts[1]

    if(key.length !== 24 && key.length !== 48) { return callback(null, _h.error([400, 'Invalid key'])) }

    const sessionAuth = key.length === 24

    var authValue
    var connection

    async.waterfall([
        (callback) => {
            _h.db('entu', callback)
        },
        (con, callback) => {
            connection = con

            if (sessionAuth) {
                connection.collection('session').findOneAndUpdate({ _id: new objectId(key), deleted: { $exists: false } }, { $set: { deleted: new Date() } }, (err, sess) => {
                    if(err) { return callback(err) }
                    if(!sess.value) { return callback([400, 'No session']) }

                    authValue = _.get(sess, 'value.user.email')

                    return callback(null)
                })
            } else {
                authValue = key

                return callback(null)
            }
        },
        (callback) => {
            connection.admin().listDatabases(callback)
        },
        (dbs, callback) => {
            async.map(_.map(dbs.databases, 'name'), (account, callback) => {
                if (mongoDbSystemDbs.indexOf(account) !== -1) { return callback(null) }

                async.waterfall([
                    (callback) => {
                        _h.db(account, callback)
                    },
                    (accountCon, callback) => {
                        let authFilter = {}
                        authFilter[sessionAuth ? 'private.entu_user.string' : 'private.entu_api_key.string'] = authValue
                        accountCon.collection('entity').findOne(authFilter, { _id: true }, callback)
                    }
                ], (err, person) => {
                    if(err) { return callback(err) }
                    if(!person) { return callback(null) }

                    return callback(null, {
                        _id: person._id.toString(),
                        account: account,
                        token: jwt.sign({}, process.env.JWT_SECRET, {
                            issuer: account,
                            audience: _.get(event, 'requestContext.identity.sourceIp'),
                            subject: person._id.toString(),
                            expiresIn: '48h'
                        })
                    })
                })
            }, callback)
        }
    ], (err, accounts) => {
        if (err) { return callback(null, _h.error(err)) }

        callback(null, _h.json(_.mapValues(_.groupBy(_.compact(accounts), 'account'), (o) => {
            return _.first(o)
        })))
    })
}
