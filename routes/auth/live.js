var _        = require('lodash')
var live     = require('passport-windowslive').Strategy
var op       = require('object-path')
var passport = require('passport')
var router   = require('express').Router()

var entu   = require('../../helpers/entu')



passport.use(new live({
        clientID: LIVE_ID,
        clientSecret: LIVE_SECRET,
        callbackURL: '/auth/live/callback',
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

    res.redirect('/auth/live/auth')
})



router.get('/auth', passport.authenticate('windowslive', { scope: ['wl.basic', 'wl.emails'], session: false }), function() {

})



router.get('/callback', passport.authenticate('windowslive', { failureRedirect: '/login', session: false }), function(req, res, next) {
    var user = {}
    var name = _.compact([
        op.get(req, ['user', 'name', 'givenName']),
        op.get(req, ['user', 'name', 'middleName']),
        op.get(req, ['user', 'name', 'familyName'])
    ]).join(' ')

    op.set(user, 'provider', 'live')
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
            res.redirect('/auth/session/' + sessionId)
        }
    })
})



module.exports = router
