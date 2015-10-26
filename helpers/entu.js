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
        browser: op.get(params, 'request.headers.user-agent'),
    }

    async.waterfall([
        function(callback) {
            mongo.connect(APP_MONGODB + 'entu', callback)
        },
        function(connection, callback) {
            connection.collection('session').insertOne(session, callback)
        },
    ], function(err, results) {
        if (err) return callback(err)

        params.response.cookie('session', session.key, {
            maxAge: 14 * 24 * 60 * 60 * 1000,
            domain: APP_COOKIE_DOMAIN
        })

        callback(null, {
            session: session.key
        })
    })
}
