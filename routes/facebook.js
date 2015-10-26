var router   = require('express').Router()
var passport = require('passport')
var facebook = require('passport-facebook').Strategy
var op       = require('object-path')



passport.use(new facebook({
        clientID: FACEBOOK_ID,
        clientSecret: FACEBOOK_SECRET,
        callbackURL: '/facebook/callback',
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

    res.redirect('/facebook/auth')
})



router.get('/auth', passport.authenticate('facebook', { scope: ['email'], session: false }), function(req, res, next) {

})



router.get('/callback', passport.authenticate('facebook', { failureRedirect: '/login', session: false }), function(req, res, next) {
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
    }, function(err, session) {
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
