var _       = require('lodash')
var async   = require('async')
var jwt     = require('jsonwebtoken')
var mongo   = require('mongodb')
var op      = require('object-path')
var request = require('request')



// returns random v4 UUID
var UUID = function(a) {
    return a ? (a ^ Math.random() * 16 >> a / 4).toString(16) : ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, UUID)
}
exports.UUID = UUID



// returns MongoDb Id
var objectId = function(id) {
    try {
        return new mongo.ObjectID(id)
    } catch (e) {

    }
}
exports.objectId = objectId



// returns db connection (creates if not set)
var dbConnection = function(customer, callback) {
    if(_.has(APP_DBS, customer)) {
        callback(null, APP_DBS[customer])
    } else {
        async.waterfall([
            function(callback) {
                mongo.MongoClient.connect(APP_MONGODB, { ssl: true, sslValidate: false, autoReconnect: true }, callback)
            },
            function(connection, callback) {
                connection.collection('entity').findOne({ 'database_name.string': customer, 'mongodb.string': { '$exists': true }, deleted_at: { '$exists': false }, deleted_by: { '$exists': false } }, { _id: false, 'mongodb.string': true }, callback)
            },
            function(url, callback) {
                let mongoUrl = url.mongodb[0].string

                if (!mongoUrl) { return callback('No MongoDb url')}

                mongo.MongoClient.connect(mongoUrl, { ssl: true, sslValidate: false, autoReconnect: true }, callback)
            },
        ], function(err, connection) {
            if(err) { return callback(err) }

            connection.on('close', function(err) {
                delete APP_DBS[customer]
            })

            APP_DBS[customer] = connection
            callback(null, APP_DBS[customer])
        })
    }
}
exports.dbConnection = dbConnection



// send out JSON
exports.customResponder = function(req, res, next) {
    res.respond = function(body, errorCode) {
        var message = {
            version: APP_VERSION,
            ms: Date.now() - req.startDt,
            auth: !!req.user
        }

        if (errorCode) {
            message.error = {
                code: errorCode,
                message: body
            }
            res.status(errorCode).send(message)
        } else {
            message.result = body
            res.send(message)
        }
    }

    next(null)
}



// check JWT header
exports.jwtCheck = function(req, res, next) {
    var parts = op.get(req, 'headers.authorization', '').split(' ')
    let jwtConf = {
        issuer: req.hostname
    }

    if (req.query.customer) {
        req.customer = req.query.customer
        jwtConf.audience = req.query.customer
    }

    if(parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') { return next(null) }

    jwt.verify(parts[1], APP_JWT_SECRET, jwtConf, function(err, decoded) {
        if(err) { return next([401, err]) }

        op.set(req, 'user', objectId(decoded.sub))
        op.set(req, 'customer', decoded.aud)

        next(null)
    })
}



// Create requestlog entry on response finish
exports.requestLog = function(req, res, next) {
    req.startDt = Date.now()

    res.on('finish', function() {
        var request = {
            date: new Date(),
            ip: req.ip,
            ms: Date.now() - req.startDt,
            status: res.statusCode,
            method: req.method,
            host: req.hostname,
            browser: req.headers['user-agent'],
        }
        if(req.path) { request.path = req.path }
        if(!_.isEmpty(req.query)) { request.query = req.query }
        if(!_.isEmpty(req.body)) { request.body = req.body }
        if(req.browser) { request.browser = req.headers['user-agent'] }

        async.waterfall([
            function(callback) {
                dbConnection('entu', callback)
            },
            function(connection, callback) {
                connection.collection('request').insertOne(request, callback)
            },
        ], function(err) {
            if(err) {
                console.error(err.toString(), '- Can\'t save request')
                return next(null)
            }
        })
    })

    next(null)
}



// Create user session
exports.addUserSession = function(params, callback) {
    if(!params.user) { return callback(new Error('no user')) }

    var session = {
        created: new Date()
    }

    if(op.get(params, 'user.id')) { op.set(session, 'user.id', op.get(params, 'user.id')) }
    if(op.get(params, 'user.provider')) { op.set(session, 'user.provider', op.get(params, 'user.provider')) }
    if(op.get(params, 'user.name')) { op.set(session, 'user.name', op.get(params, 'user.name')) }
    if(op.get(params, 'user.email')) { op.set(session, 'user.email', op.get(params, 'user.email')) }
    if(op.get(params, 'user.picture')) { op.set(session, 'user.picture', op.get(params, 'user.picture')) }
    if(op.get(params, 'request.ip')) { op.set(session, 'ip', op.get(params, 'request.ip')) }
    if(op.get(params, 'request.headers.user-agent')) { op.set(session, 'browser', op.get(params, 'request.headers.user-agent')) }
    if(op.get(params, 'request.cookies.redirect')) { op.set(session, 'redirect', op.get(params, 'request.cookies.redirect')) }

    async.waterfall([
        function(callback) {
            dbConnection('entu', callback)
        },
        function(connection, callback) {
            connection.collection('session').insertOne(session, callback)
        },
    ], function(err, r) {
        if(err) { return callback(err) }

        callback(null, r.insertedId)
    })
}



// Get entities
exports.getEntities = function(params, callback) {

}
