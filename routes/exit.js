var router   = require('express').Router()

var entu   = require('../helpers/entu')



router.get('/', function(req, res, next) {
    entu.sessionEnd(req.cookies.session, function(err) {
        if(err) return next(err)

        res.clearCookie('session', {
            domain: APP_COOKIE_DOMAIN
        })

        var redirectUrl = req.query.next
        if(redirectUrl) {
            res.redirect(redirectUrl)
        } else {
            res.send({
                result: true,
                version: APP_VERSION,
                started: APP_STARTED
            })
        }
    })
})



module.exports = router
