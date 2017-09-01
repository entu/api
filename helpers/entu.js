'use strict'

const _ = require('lodash')
const async = require('async')
const mongo = require('mongodb')



// returns random v4 UUID
var UUID = (a) => {
    return a ? (a ^ Math.random() * 16 >> a / 4).toString(16) : ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, UUID)
}
exports.UUID = UUID



// Create user session
exports.addUserSession = (params, callback) => {
    if(!params.user) { return callback('No user') }

    var session = {
        created: new Date()
    }

    if(_.get(params, 'user.id')) { _.set(session, 'user.id', _.get(params, 'user.id')) }
    if(_.get(params, 'user.provider')) { _.set(session, 'user.provider', _.get(params, 'user.provider')) }
    if(_.get(params, 'user.name')) { _.set(session, 'user.name', _.get(params, 'user.name')) }
    if(_.get(params, 'user.email')) { _.set(session, 'user.email', _.get(params, 'user.email')) }
    if(_.get(params, 'user.picture')) { _.set(session, 'user.picture', _.get(params, 'user.picture')) }
    if(_.get(params, 'request.ip')) { _.set(session, 'ip', _.get(params, 'request.ip')) }
    if(_.get(params, 'request.headers.user-agent')) { _.set(session, 'browser', _.get(params, 'request.headers.user-agent')) }
    if(_.get(params, 'request.cookies.redirect')) { _.set(session, 'redirect', _.get(params, 'request.cookies.redirect')) }

    async.waterfall([
        (callback) => {
            params.request.app.locals.db('entu', callback)
        },
        (connection, callback) => {
            connection.collection('session').insertOne(session, callback)
        },
    ], (err, r) => {
        if(err) { return callback(err) }

        return callback(null, r.insertedId)
    })
}



// Aggregate entity from property collection
exports.aggregateEntity = (req, entityId, property, callback) => {
    var connection

    async.waterfall([
        (callback) => {
            req.app.locals.db(req.customer, callback)
        },
        (con, callback) => {
            connection = con

            connection.collection('property').find({ entity: entityId, deleted: { '$exists': false } }).toArray((err, properties) => {
                if(err) { return callback(err) }

                let p = _.mapValues(_.groupBy(properties, 'definition'), (o) => {
                    return _.map(o, (p) => {
                        return _.omit(p, ['entity', 'definition', 'created', 's3', 'url'])
                    })
                })

                let access = _.map(_.union(p._viewer, p._expander, p._editor, p._owner), 'reference')
                if (access.length > 0) {
                    p._access = access
                }

                if (!_.isEmpty(p)) {
                    connection.collection('entity').update({ _id: entityId }, { '$set': p, }, callback)
                } else {
                    return callback(null)
                }
            })
        },
    ], callback)
}
