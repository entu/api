var _        = require('lodash')
var op       = require('object-path')
var passport = require('passport')
var router   = require('express').Router()
var twitter  = require('passport-twitter').Strategy

var entu   = require('../../helpers/entu')



passport.use(new twitter({
        consumerKey: TWITTER_KEY,
        consumerSecret: TWITTER_SECRET,
        callbackURL: '/auth/twitter/callback',
        proxy: true
    },
    function(token, tokenSecret, profile, done) {
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

    res.redirect('/auth/twitter/auth')
})



router.get('/auth', passport.authenticate('twitter'), function() {

})



router.get('/callback', passport.authenticate('twitter', { failureRedirect: '/login' }), function(req, res, next) {
    var user = {}
    var name = _.compact([
        op.get(req, ['user', 'name', 'givenName']),
        op.get(req, ['user', 'name', 'middleName']),
        op.get(req, ['user', 'name', 'familyName'])
    ]).join(' ')

    op.set(user, 'provider', 'twitter')
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
