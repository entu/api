var router   = require('express').Router()
var passport = require('passport')
var live     = require('passport-windowslive').Strategy
var op       = require('object-path')

var entu   = require('../helpers/entu')



passport.use(new live({
        clientID: LIVE_ID,
        clientSecret: LIVE_SECRET,
        callbackURL: '/live/callback',
        proxy: true
    },
    function(accessToken, refreshToken, profile, done) {
        process.nextTick(function () {
            return done(null, profile)
        })
  }
))



router.get('/', function(req, res, next) {
    res.clearCookie('redirect')
    res.clearCookie('session', {
        domain: APP_COOKIE_DOMAIN
    })

    if(req.query.next) {
        res.cookie('redirect', req.query.next, {
            maxAge: 60 * 60 * 1000
        })
    }

    res.redirect('/live/auth')
})



router.get('/auth', passport.authenticate('windowslive', { scope: ['wl.basic', 'wl.emails'], session: false }), function(req, res, next) {

})



router.get('/callback', passport.authenticate('windowslive', { failureRedirect: '/login', session: false }), function(req, res, next) {
    var user = {}
    op.set(user, 'provider', 'live')
    op.set(user, 'id', op.get(req, ['user', 'id']))
    op.set(user, 'name', op.get(req, ['user', 'displayName']))
    op.set(user, 'email', op.get(req, ['user', 'emails', 0, 'value']))
    op.set(user, 'picture', op.get(req, ['user', 'photos', 0, 'value']))

    entu.session_start({
        request: req,
        response: res,
        user: user
    }, function(err, session) {
        if(err) return next(err)

        var redirect_url = req.cookies.redirect
        if(redirect_url) {
            res.cookie('session', session.session, {
                maxAge: 14 * 24 * 60 * 60 * 1000,
                domain: APP_COOKIE_DOMAIN
            })
            res.clearCookie('redirect')
            res.redirect(redirect_url)
        } else {
            res.send({
                result: session,
                version: APP_VERSION,
                started: APP_STARTED
            })
        }
    })
})



module.exports = router