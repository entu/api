'use strict'

const _ = require('lodash')
const async = require('async')



// returns random v4 UUID
exports.UUID = (a) => {
    return a ? (a ^ Math.random() * 16 >> a / 4).toString(16) : ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, UUID)
}



// Create user session
exports.addUserSession = (params, callback) => {
    if(!params.user) { return callback('No user') }

    var session = {}

    _.set(session, 'created', new Date())
    _.set(session, 'user.id', _.get(params, 'user.id'))
    _.set(session, 'user.provider', _.get(params, 'user.provider'))
    _.set(session, 'user.name', _.get(params, 'user.name'))
    _.set(session, 'user.email', _.get(params, 'user.email'))
    _.set(session, 'user.picture', _.get(params, 'user.picture'))

    async.waterfall([
        (callback) => {
            params.request.app.locals.db('entu', callback)
        },
        (connection, callback) => {
            connection.collection('session').insertOne(_.pickBy(session, _.identity), callback)
        }
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
            req.app.locals.db(req.account, callback)
        },
        (con, callback) => {
            connection = con
            connection.collection('property').find({ entity: entityId, deleted: { $exists: false } }).toArray((err, props) => {
                if(err) { return callback(err) }

                let properties = _.mapValues(_.groupBy(props, 'type'), (o) => {
                    return _.map(o, (p) => {
                        return _.omit(p, ['entity', 'type', 'created', 's3', 'url'])
                    })
                })

                const access = _.map(_.union(properties._viewer, properties._expander, properties._editor, properties._owner), 'reference')
                if (access.length > 0) {
                    properties._access = access
                }

                if (!_.isEmpty(p)) {
                    if (_.has(p, '_deleted')) {
                        connection.collection('entity').deleteOne({ _id: entityId }, callback)
                    } else {
                        connection.collection('entity').update({ _id: entityId }, p, callback)
                    }
                } else {
                    return callback(null)
                }
            })
        },
    ], callback)
}
