var mongo  = require('mongodb').MongoClient
var async  = require('async')
var op     = require('object-path')
var random = require('randomstring')



// Create user session
exports.session_start = function(params, callback) {
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
            mongo.connect(APP_MONGODB + 'entu', callback)
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
exports.session_end = function(session_key, callback) {
    if(!session_key) return callback(new Error('No session key'))

    async.waterfall([
        function(callback) {
            mongo.connect(APP_MONGODB + 'entu', callback)
        },
        function(connection, callback) {
            connection.collection('session').deleteMany({key: session_key}, callback)
        },
    ], function(err, results) {
        if (err) return callback(err)

        callback(null, {})
    })
}
