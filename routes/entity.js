var async  = require('async')
var router = require('express').Router()

var entu   = require('../helpers/entu')



router.get('/', function(req, res, next) {
    res.respond(req.user)
})



router.get('/:entityId', function(req, res, next) {
    var entityId = entu.objectId(req.params.entityId)

    if (!entityId) { return next([422, new Error('Invalid Entity ID')]) }
    if (!req.customer) { return next([400, new Error('No customer parameter')]) }

    async.waterfall([
        function(callback) {
            entu.dbConnection(req.customer, callback)
        },
        function(connection, callback) {
            connection.collection('entity').findOne({ _id: entityId }, { _mid: false }, callback)
        },
    ], function(err, entity) {
        if (err) { return next(err) }

        if (!entity) { return next([404, new Error('Entity not found')]) }
        if (op.get(entity, '_access', []).indexOf(req.user) === -1 && op.get(entity, '_sharing.0.string', '') !== 'public') { return next([403, new Error('Forbidden')]) }

        res.respond(entity)
    })
})



module.exports = router
