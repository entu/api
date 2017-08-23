'use strict'

const _ = require('lodash')
const async = require('async')
const jwt = require('jsonwebtoken')
const router = require('express').Router()



router.get('/session/:sessionId', (req, res, next) => {
    var conection
    var session

    async.waterfall([
        (callback) => {
            req.app.locals.db('entu', callback)
        },
        (con, callback) => {
            conection = con
            conection.collection('session').findAndModify({ _id: new mongo.ObjectID(req.params.sessionId), deleted: { $exists: false } }, [[ '_id', 1 ]], { '$set': { deleted: new Date() } }, callback)
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
                    (con, callback) => {
                        con.collection('entity').findOne({ 'entu_user.string': session.user.email, _deleted: { $exists: false } }, { _id: true }, callback)
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
