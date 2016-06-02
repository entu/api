var _      = require('underscore')
var async  = require('async')
var entu   = require('../../helpers/entu')
var jwt    = require('jsonwebtoken')
var router = require('express').Router()



router.get('/session', function(req, res, next) {
    if(!req.query.session) { return next([400, 'No session']) }

    var conection
    var session

    async.waterfall([
        function(callback) {
            entu.dbConnection('entu', callback)
        },
        function(con, callback) {
            conection = con
            conection.collection('session').findAndModify({ _id: entu.objectId(req.query.session), deleted: { $exists: false } }, [[ '_id', 1 ]], { '$set': { deleted: new Date() } }, callback)
        },
        function(sess, callback) {
            if(!sess.value) { return callback([400, 'No session']) }

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
                        conection.collection('entityVersion').findOne({'entu_user.value': session.user.email, _deleted: { $exists: false }}, {_id: false, _entity: true}, function(err, person) {
                            if(err) { return callback(err) }

                            callback(null, {
                                name: NaN,
                                db: database,
                                token: jwt.sign({ db: database, _entity: person._entity }, APP_JWT_SECRET)
                            })
                        })
                    },
                ], callback)
            }, callback)
        },
    ], function(err, persons) {
        if(err) { return next(err) }

        res.send({
            version: APP_VERSION,
            result: _.indexBy(persons, 'db'),
            started: APP_STARTED
        })
    })
})



module.exports = router
