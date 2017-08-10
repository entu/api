var async  = require('async')
var router = require('express').Router()

var entu   = require('../helpers/entu')



router.get('/', function(req, res, next) {
    res.respond(req.user)
})



router.get('/:entityId', function(req, res, next) {
    entityId = entu.objectId(entityId)

    if (!entityId) { return callback([422, new Error('Invalid Entity ID')]) }
    if (!req.user) { return callback([403, new Error('Forbidden')]) }
    if (!req.customer) { return callback([400, new Error('No customer parameter')]) }

    async.waterfall([
        function(callback) {
            dbConnection(req.customer, callback)
        },
        function(connection, callback) {
            connection.collection('entity').findOne({ _id: entityId, _access: req.user }, { _mid: false, _access: false }, callback)
        },
    ], function(err, entity) {
        if(err) { return callback(err) }

        res.respond(entity)
    })
})



module.exports = router
