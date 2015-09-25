var router   = require('express').Router()
var passport = require('passport')
var twitter  = require('passport-twitter').Strategy
var op       = require('object-path')



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

router.get('/', passport.authenticate('twitter'), function(req, res, next) {

})



router.get('/callback', passport.authenticate('twitter', { failureRedirect: '/login' }), function(req, res, next) {
    var user = {}
    op.set(user, 'provider', op.get(req, ['user', 'provider']))
    op.set(user, 'id', op.get(req, ['user', 'id']))
    op.set(user, 'name', op.get(req, ['user', 'displayName']))
    op.set(user, 'email', op.get(req, ['user', 'emails', 0, 'value']))
    op.set(user, 'picture', op.get(req, ['user', 'photos', 0, 'value']))
    op.set(user, 'gender', op.get(req, ['user', 'gender']))
    op.set(user, 'url', op.get(req, ['user', 'profileUrl']))
    op.set(user, 'raw', op.get(req, ['user', '_json']))

    res.send({
        result: user,
        version: APP_VERSION,
        started: APP_STARTED
    })
})



module.exports = router
