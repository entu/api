var router   = require('express').Router()
var passport = require('passport')
var twitter  = require('passport-twitter').Strategy
var op       = require('object-path')

var entu   = require('../helpers/entu')



passport.use(new twitter({
        consumerKey: TWITTER_KEY,
        consumerSecret: TWITTER_SECRET,
        callbackURL: '/twitter/callback',
        proxy: true
    },
    function(token, tokenSecret, profile, done) {
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

    res.redirect('/twitter/auth')
})



router.get('/auth', passport.authenticate('twitter'), function(req, res, next) {

})



router.get('/callback', passport.authenticate('twitter', { failureRedirect: '/login' }), function(req, res, next) {
    var user = {}
    op.set(user, 'provider', 'twitter')
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