var _       = require('underscore')
var async   = require('async')
var jwt    = require('jsonwebtoken')
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
var dbConnection = function(db, callback) {
    if(_.has(APP_ENTU_DBS, db)) {
        callback(null, APP_ENTU_DBS[db])
    } else {
        mongo.MongoClient.connect(APP_MONGODB + db, { server: { autoReconnect: true } }, function(err, connection) {
            if(err) { return callback(err) }

            // connection.collection('entityVersion').createIndex({ _mid: 1 }, { background:true }, function(err, indexName) {
            //     if(err) { console.log(db, err) }
            //     if(indexName) { console.log(db, indexName) }
            // })
            // connection.collection('entityVersion').createIndex({ _deleted: 1 }, { background:true }, function(err, indexName) {
            //     if(err) { console.log(db, err) }
            //     if(indexName) { console.log(db, indexName) }
            // })
            // connection.collection('entityVersion').createIndex({ 'entu_user.value': 1 }, { background:true }, function(err, indexName) {
            //     if(err) { console.log(db, err) }
            //     if(indexName) { console.log(db, indexName) }
            // })

            connection.on('close', function(err) {
                delete APP_ENTU_DBS[db]
            })

            APP_ENTU_DBS[db] = connection
            callback(null, APP_ENTU_DBS[db])
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
            message.error = body
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

    op.set(req, 'customer', req.query.customer)

    if(parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') { return next(null) }

    jwt.verify(parts[1], APP_JWT_SECRET, { issuer: req.hostname, audience: req.query.customer }, function(err, decoded) {
        if(err) { return next([401, err]) }

        op.set(req, 'user', decoded.sub)
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
            if(err) { return next(err) }
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
            if(!op.get(params, 'request.ip')) { return callback(null) }

            request.get({url: 'https://geoip.entu.eu/json/' + op.get(params, 'request.ip'), strictSSL: true, json: true, timeout: 1000}, function(error, response, body) {
                if(!body) { return callback(null) }

                var geo = _.pick(body, _.identity)
                delete geo.ip

                op.set(session, 'geo', geo)

                callback(null)
            })
        },
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
