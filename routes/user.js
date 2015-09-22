var router   = require('express').Router()



router.get('/', function(req, res, next) {
    var a = 1 / 0
    next(a)
})



module.exports = router
