var _        = require('underscore')
var facebook = require('passport-facebook').Strategy
var op       = require('object-path')
var passport = require('passport')
var router   = require('express').Router()

var entu   = require('../../helpers/entu')



passport.use(new facebook({
        clientID: FACEBOOK_ID,
        clientSecret: FACEBOOK_SECRET,
        callbackURL: '/auth/facebook/callback',
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
    res.clearCookie('session')

    if(req.query.next) {
        res.cookie('redirect', req.query.next, {
            maxAge: 10 * 60 * 1000
        })
    }

    res.redirect('/auth/facebook/auth')
})



router.get('/auth', passport.authenticate('facebook', { scope: ['public_profile', 'email'], session: false }), function() {

})



router.get('/callback', passport.authenticate('facebook', { failureRedirect: '/login', session: false }), function(req, res, next) {
    var user = {}
    var name = _.compact([
        op.get(req, ['user', 'name', 'givenName']),
        op.get(req, ['user', 'name', 'middleName']),
        op.get(req, ['user', 'name', 'familyName'])
    ]).join(' ')

    op.set(user, 'provider', 'facebook')
    op.set(user, 'id', op.get(req, ['user', 'id']))
    op.set(user, 'name', name)
    op.set(user, 'email', op.get(req, ['user', 'emails', 0, 'value']))
    op.set(user, 'picture', op.get(req, ['user', 'photos', 0, 'value']))

    entu.addUserSession({
        request: req,
        user: user
    }, function(err, sessionId) {
        if(err) { return next(err) }

        var redirectUrl = req.cookies.redirect
        if(redirectUrl) {
            res.clearCookie('redirect')
            res.redirect(redirectUrl + '?session=' + sessionId)
        } else {
            res.send({
                result: { session: sessionId },
                version: APP_VERSION,
                started: APP_STARTED
            })
        }
    })
})



module.exports = router
