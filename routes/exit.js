var router   = require('express').Router()

var entu   = require('../helpers/entu')



router.get('/', function(req, res, next) {
    entu.session_end(req.cookies.session, function(err, session) {
        if(err) return next(err)

        res.clearCookie('session', {
            domain: APP_COOKIE_DOMAIN
        })

        var redirect_url = req.query.next
        if(redirect_url) {
            res.redirect(redirect_url)
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
