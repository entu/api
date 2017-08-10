var async  = require('async')
var router = require('express').Router()

var entu   = require('../helpers/entu')



router.get('/', function(req, res, next) {
    res.respond(req.user)
})



module.exports = router
