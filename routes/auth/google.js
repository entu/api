var _        = require('underscore')
var google   = require('passport-google-oauth').OAuth2Strategy
var op       = require('object-path')
var passport = require('passport')
var router   = require('express').Router()

var entu   = require('../../helpers/entu')



passport.use(new google({
        clientID: GOOGLE_ID,
        clientSecret: GOOGLE_SECRET,
        callbackURL: '/auth/google/callback',
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

    res.redirect('/auth/google/auth')
})



router.get('/auth', passport.authenticate('google', { scope: ['https://www.googleapis.com/auth/userinfo.profile', 'https://www.googleapis.com/auth/userinfo.email'], session: false }), function() {

})



router.get('/callback', passport.authenticate('google', { failureRedirect: '/login', session: false }), function(req, res, next) {
    var user = {}
    var name = _.compact([
        op.get(req, ['user', 'name', 'givenName']),
        op.get(req, ['user', 'name', 'middleName']),
        op.get(req, ['user', 'name', 'familyName'])
    ]).join(' ')

    op.set(user, 'provider', 'google')
    op.set(user, 'id', op.get(req, ['user', 'id']))
    op.set(user, 'name', name)
    op.set(user, 'email', op.get(req, ['user', 'emails', 0, 'value']))
    op.set(user, 'picture', op.get(req, ['user', 'photos', 0, 'value']).replace('?sz=50', ''))

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