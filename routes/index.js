var router   = require('express').Router()



router.get('/', function(req, res) {
    res.send({
        result: true,
        version: APP_VERSION,
        started: APP_STARTED
    })
})



module.exports = router
