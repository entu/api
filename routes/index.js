var router   = require('express').Router()

var entu   = require('../helpers/entu')



router.get('/', function(req, res, next) {
    res.send({
        result: true,
        version: APP_VERSION,
        started: APP_STARTED
    })
})



module.exports = router
