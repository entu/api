var facebook = require('passport-facebook').Strategy
var op       = require('object-path')
var passport = require('passport')
var router   = require('express').Router()

var entu   = require('../helpers/entu')



passport.use(new facebook({
        clientID: FACEBOOK_ID,
        clientSecret: FACEBOOK_SECRET,
        callbackURL: '/facebook/callback',
        profileFields: ['id', 'name', 'email', 'picture'],
        proxy: true
    },
    function(accessToken, refreshToken, profile, done) {
        process.nextTick(function() {
            return done(null, profile)
        })
  }
))



router.get('/', function(req, res) {
    res.clearCookie('redirect')
    res.clearCookie('session', {
        domain: APP_COOKIE_DOMAIN
    })

    if(req.query.next) {
        res.cookie('redirect', req.query.next, {
            maxAge: 60 * 60 * 1000
        })
    }

    res.redirect('/facebook/auth')
})



router.get('/auth', passport.authenticate('facebook', { scope: ['public_profile', 'email'], session: false }), function() {

})



router.get('/callback', passport.authenticate('facebook', { failureRedirect: '/login', session: false }), function(req, res, next) {
    var user = {}
    op.set(user, 'provider', 'facebook')
    op.set(user, 'id', op.get(req, ['user', 'id']))
    op.set(user, 'name', op.get(req, ['user', 'displayName']))
    op.set(user, 'email', op.get(req, ['user', 'emails', 0, 'value']))
    op.set(user, 'picture', op.get(req, ['user', 'photos', 0, 'value']))

    entu.sessionStart({
        request: req,
        response: res,
        user: user
    }, function(err, session) {
        if(err) { return next(err) }

        var redirectUrl = req.cookies.redirect
        if(redirectUrl) {
            res.cookie('session', session.session, {
                maxAge: 14 * 24 * 60 * 60 * 1000,
                domain: APP_COOKIE_DOMAIN
            })
            res.clearCookie('redirect')
            res.redirect(redirectUrl)
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
