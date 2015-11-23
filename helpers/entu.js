var async  = require('async')
var fs     = require('fs')
var mongo  = require('mongodb').MongoClient
var op     = require('object-path')
var random = require('randomstring')



var mongodb_options = {}
if(APP_MONGODB_CA) {
    var ca = [fs.readFileSync(APP_MONGODB_CA)]
    mongodb_options = {
        mongos: {
            ssl: true,
            sslValidate: true,
            sslCA: ca,
            ca: ca
        }
    }
}



// Create user session
exports.sessionStart = function(params, callback) {
    if(!params.user) return callback(new Error('No user'))

    var session = {
        created: new Date(),
        key: random.generate(64),
        user: {
            id: op.get(params, 'user.id'),
            provider: op.get(params, 'user.provider'),
            name: op.get(params, 'user.name'),
            email: op.get(params, 'user.email'),
            picture: op.get(params, 'user.picture')
        },
        ip: op.get(params, 'request.ip'),
        browser: op.get(params, 'request.headers.user-agent')
    }
    if(op.has(params, 'request.cookies.redirect')) session.redirect = op.get(params, 'request.cookies.redirect')

    async.waterfall([
        function(callback) {
            mongo.connect(APP_MONGODB + 'entu', mongodb_options, callback)
        },
        function(connection, callback) {
            connection.collection('session').insertOne(session, callback)
        },
    ], function(err) {
        if (err) return callback(err)

        callback(null, {
            session: session.key
        })
    })
}



// Destoy user session
exports.sessionEnd = function(sessionKey, callback) {
    if(!sessionKey) return callback(new Error('No session key'))

    async.waterfall([
        function(callback) {
            mongo.connect(APP_MONGODB + 'entu', mongodb_options, callback)
        },
        function(connection, callback) {
            connection.collection('session').deleteMany({key: sessionKey}, callback)
        },
    ], function(err) {
        if (err) return callback(err)

        callback(null, {})
    })
}
