'use strict'

const _ = require('lodash')
const async = require('async')
const jwt = require('jsonwebtoken')
const ObjectID = require('mongodb').ObjectID
const router = require('express').Router()



router.get('/session/:sessionId', (req, res, next) => {
    var connection
    var session

    async.waterfall([
        (callback) => {
            req.app.locals.db('entu', callback)
        },
        (con, callback) => {
            connection = con
            connection.collection('session').findOneAndUpdate({ _id: new ObjectID(req.params.sessionId), deleted: { $exists: false } }, { '$set': { deleted: new Date() } }, callback)
        },
        (sess, callback) => {
            if(!sess.value) { return callback([400, 'No session']) }

            session = sess.value
            return callback(null, process.env.CUSTOMERS.split(','))
        },
        (customers, callback) => {
            async.map(customers, (customer, callback) => {
                async.waterfall([
                    (callback) => {
                        req.app.locals.db(customer, callback)
                    },
                    (customerCon, callback) => {
                        customerCon.collection('entity').findOne({ 'entu_user.string': session.user.email, _deleted: { $exists: false } }, { _id: true }, callback)
                    },
                ], (err, person) => {
                    if(err) { return callback(err) }
                    if(!person) { return callback(null) }

                    return callback(null, {
                        title: null,
                        customer: customer,
                        token: jwt.sign({}, process.env.JWT_SECRET, {
                            issuer: req.hostname,
                            audience: customer,
                            subject: person._id.toString(),
                            expiresIn: '14d'
                        })
                    })
                })
            }, callback)
        },
    ], (err, customers) => {
        if(err) { return next(err) }

        res.respond(_.mapValues(_.groupBy(customers, 'customer'), _.first))
    })
})



module.exports = router
