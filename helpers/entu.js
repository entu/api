var async     = require('async')
var op        = require('object-path')
var random    = require('randomstring')
var rethinkdb = require('rethinkdb')



// Create user session
exports.sessionStart = function(params, callback) {
    if(!params.user) { return callback(new Error('No user')) }

    var session = {
        created: new Date(),
        key: random.generate(64),
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
            rethinkdb.connect({ host: APP_RETHINKDB_HOST }, function(err, conn) {
                if(err) { return callback(err) }

                var connection = conn

                async.waterfall([
                    function(callback) {
                        rethinkdb.dbList().run(connection, callback)
                    },
                    function(dbList, callback) {
                        if(dbList.indexOf('entu') > -1) {
                            connection.use('entu')
                            callback()
                        } else {
                            rethinkdb.dbCreate('entu').run(connection, function(err) {
                                if(err) { return callback(err) }
                                connection.use('entu')
                                callback()
                            })
                        }
                    },
                    function(callback) {
                        rethinkdb.tableList().run(connection, callback)
                    },
                    function(tableList, callback) {
                        if(tableList.indexOf('session') > -1) {
                            callback()
                        } else {
                            rethinkdb.tableCreate('session').run(connection, callback)
                        }
                    },

                ], function(err) {
                    if(err) { return callback(err) }

                    callback(null, connection)
                })
            })
        },
        function(connection, callback) {
            rethinkdb.table('session').insert(session).run(connection, callback)
        },
    ], function(err) {
        if(err) { return callback(err) }

        callback(null, {
            session: session.key
        })
    })
}



// Destoy user session
exports.sessionEnd = function(sessionKey, callback) {
    if(!sessionKey) { return callback(new Error('No session key')) }

    async.waterfall([
        function(callback) {
            rethinkdb.connect({ host: APP_RETHINKDB_HOST, db: 'entu' }, callback)
        },
        function(connection, callback) {
            rethinkdb.table('session').filter({key: sessionKey}).delete().run(connection, callback)
        },
    ], function(err) {
        if(err) { return callback(err) }

        callback(null, {})
    })
}
