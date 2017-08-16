'use strict'

const _ = require('lodash')
const async = require('async')
const mongo = require('mongodb')



// returns random v4 UUID
var UUID = (a) => {
    return a ? (a ^ Math.random() * 16 >> a / 4).toString(16) : ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, UUID)
}
exports.UUID = UUID



// returns MongoDb Id
var objectId = (id) => {
    try {
        return new mongo.ObjectID(id)
    } catch (e) {
        return null
    }
}
exports.objectId = objectId



// returns db connection (creates if not set)
var dbConnection = (customer, callback) => {
    if(_.has(app, ['locals', 'dbs', customer])) {
        return callback(null, app.locals.dbs[customer])
    } else {
        var entuDb
        async.waterfall([
            (callback) => {
                mongo.MongoClient.connect(process.env.MONGODB, { ssl: true, sslValidate: true }, callback)
            },
            (connection, callback) => {
                entuDb = connection
                entuDb.collection('entity').findOne({ 'database_name.string': customer, 'mongodb.string': { '$exists': true }, deleted_at: { '$exists': false }, deleted_by: { '$exists': false } }, { _id: false, 'mongodb.string': true }, callback)
            },
            (url, callback) => {
                entuDb.close()

                let mongoUrl = url.mongodb[0].string

                if (!mongoUrl) { return callback('No MongoDb url')}

                mongo.MongoClient.connect(mongoUrl, { ssl: true, sslValidate: true }, callback)
            },
        ], (err, connection) => {
            if(err) { return callback(err) }

            console.log('Connected to ' + customer)

            connection.on('close', () => {
                delete app.locals.dbs[customer]
                console.log('Disconnected from ' + customer)
            })

            app.locals.dbs[customer] = connection
            return callback(null, app.locals.dbs[customer])
        })
    }
}
exports.dbConnection = dbConnection



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
            dbConnection('entu', callback)
        },
        (connection, callback) => {
            connection.collection('session').insertOne(session, callback)
        },
    ], (err, r) => {
        if(err) { return callback(err) }

        return callback(null, r.insertedId)
    })
}
