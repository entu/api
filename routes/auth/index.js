var _      = require('underscore')
var async  = require('async')
var jwt    = require('jsonwebtoken')
var router = require('express').Router()

var entu   = require('../../helpers/entu')


router.get('/session/:sessionId', function(req, res, next) {
    var conection
    var session

    async.waterfall([
        function(callback) {
            entu.dbConnection('entu', callback)
        },
        function(con, callback) {
            conection = con
            conection.collection('session').findAndModify({ _id: entu.objectId(req.params.sessionId), deleted: { $exists: false } }, [[ '_id', 1 ]], { '$set': { deleted: new Date() } }, callback)
        },
        function(sess, callback) {
            if(!sess.value) { return callback([400, new Error('no session')]) }

            session = sess.value
            conection.admin().listDatabases(callback)
        },
        function(databases, callback) {
            async.map(databases.databases, function(db, callback) {
                var database = db.name
                async.waterfall([
                    function(callback) {
                        entu.dbConnection(database, callback)
                    },
                    function(con, callback) {
                        con.collection('entityVersion').findOne({'entu_user.value': session.user.email, _deleted: { $exists: false }}, {_id: false, _entity: true}, callback)
                    },
                ], function(err, person) {
                    if(err) { return callback(err) }
                    if(!person) { return callback(null) }

                    callback(null, {
                        name: null,
                        db: database,
                        token: jwt.sign({}, APP_JWT_SECRET, {
                            issuer: req.hostname,
                            audience: database,
                            subject: person._entity.toString(),
                            expiresIn: '14d'
                        })
                    })
                })
            }, callback)
        },
    ], function(err, persons) {
        if(err) { return next(err) }

        res.send({
            result: _.indexBy(persons, 'db'),
            version: APP_VERSION,
            started: APP_STARTED
        })
    })
})



module.exports = router
