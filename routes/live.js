var router   = require('express').Router()
var passport = require('passport')
var live     = require('passport-windowslive').Strategy
var op       = require('object-path')



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
    if(req.query.next) {
        res.cookie('auth_redirect', req.query.next, {
            maxAge: 60 * 60 * 1000,
            domain: APP_COOKIE_DOMAIN
        })
    }

    res.redirect('/live/auth')
})



router.get('/auth', passport.authenticate('windowslive', { scope: ['wl.basic', 'wl.emails'], session: false }), function(req, res, next) {

})



router.get('/callback', passport.authenticate('windowslive', { failureRedirect: '/login', session: false }), function(req, res, next) {
    var user = {}
    op.set(user, 'provider', op.get(req, ['user', 'provider']))
    op.set(user, 'id', op.get(req, ['user', 'id']))
    op.set(user, 'name', op.get(req, ['user', 'displayName']))
    op.set(user, 'email', op.get(req, ['user', 'emails', 0, 'value']))
    op.set(user, 'picture', op.get(req, ['user', 'photos', 0, 'value']))

    entu.session_start({
        request: req,
        response: res,
        user: user
    }, function(err, data) {
        if(err) return next(err)

        if(req.cookies.auth_redirect) {
            res.cookie('session', session.session, {
                maxAge: 14 * 24 * 60 * 60 * 1000,
                domain: APP_COOKIE_DOMAIN
            })
            res.redirect(req.cookies.auth_redirect)
            res.clearCookie('auth_redirect')
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
