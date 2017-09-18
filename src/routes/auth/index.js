'use strict'

const _ = require('lodash')
const async = require('async')
const jwt = require('jsonwebtoken')
const ObjectID = require('mongodb').ObjectID
const router = require('express').Router()



router.get('/', (req, res, next) => {
    let parts = _.get(req, 'headers.authorization', '').split(' ')

    if(parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') { return next([400, 'No key']) }

    const key = parts[1]

    if(key.length !== 24 && key.length !== 48) { return next([400, 'Invalid key']) }

    var sessionAuth = key.length === 24

    async.waterfall([
        (callback) => {
            req.app.locals.db('entu', callback)
        },
        (connection, callback) => {
            if (sessionAuth) {
                connection.collection('session').findOneAndUpdate({ _id: new ObjectID(key), deleted: { $exists: false } }, { $set: { deleted: new Date() } }, (err, sess) => {
                    if(err) { return next(err) }
                    if(!sess.value) { return callback([400, 'No session']) }

                    return callback(null, _.get(sess, 'value.user.email'))
                })
            } else {
                return callback(null, key)
            }
        },
        (authValue, callback) => {
            async.map(process.env.ACCOUNTS.split(','), (account, callback) => {
                async.waterfall([
                    (callback) => {
                        req.app.locals.db(account, callback)
                    },
                    (accountCon, callback) => {
                        let authFilter = {}
                        authFilter[sessionAuth ? 'entu_user.string' : 'entu_api_key.string'] = authValue
                        accountCon.collection('entity').findOne(authFilter, { _id: true }, callback)
                    }
                ], (err, person) => {
                    if(err) { return callback(err) }
                    if(!person) { return callback(null) }

                    return callback(null, {
                        account: account,
                        token: jwt.sign({}, process.env.JWT_SECRET, {
                            issuer: req.hostname,
                            audience: account,
                            subject: person._id.toString(),
                            expiresIn: '14d'
                        })
                    })
                })
            }, callback)
        },
    ], (err, accounts) => {
        if(err) { return next(err) }

        res.json(_.mapValues(_.groupBy(accounts, 'account'), (o) => {
            return _.first(_.map(o, (p) => {
                return _.omit(p, 'account')
            }))
        }))
    })
})



module.exports = router
