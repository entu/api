var router   = require('express').Router()



router.get('/', function(req, res) {
    res.send({
        result: true,
        version: APP_VERSION,
        started: APP_STARTED
    })
})



router.get('/test', function(req, res) {
    throw new Error('böö')
})



module.exports = router
