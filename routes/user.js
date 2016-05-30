var async  = require('async')
var router = require('express').Router()

var entu   = require('../helpers/entu')



router.get('/session', function(req, res, next) {

    if(!res.locals.user || !res.locals.user._id || !res.locals.user.key) { return next([403, 'No user']) }

    res.send({
        result: {
            key: res.locals.user._id + '.' + res.locals.user.key
        },
        version: APP_VERSION,
        started: APP_STARTED
    })

})



module.exports = router
