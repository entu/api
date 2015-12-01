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
    if(op.has(params, 'request.cookies.redirect')) { session.redirect = op.get(params, 'request.cookies.redirect') }

    async.waterfall([
        function(callback) {
            rethinkdb.connect(function(err, conn) {
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
            rethinkdb.connect({ db: 'entu' }, callback)
        },
        function(connection, callback) {
            rethinkdb.table('session').filter({key: sessionKey}).delete().run(connection, callback)
        },
    ], function(err) {
        if(err) { return callback(err) }

        callback(null, {})
    })
}
