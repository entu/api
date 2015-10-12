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



router.get('/', passport.authenticate('windowslive', { scope: ['wl.basic', 'wl.emails'], session: false }), function(req, res, next) {

})



router.get('/callback', passport.authenticate('windowslive', { failureRedirect: '/login', session: false }), function(req, res, next) {
    var user = {}
    op.set(user, 'provider', op.get(req, ['user', 'provider']))
    op.set(user, 'id', op.get(req, ['user', 'id']))
    op.set(user, 'name', op.get(req, ['user', 'displayName']))
    op.set(user, 'email', op.get(req, ['user', 'emails', 0, 'value']))
    op.set(user, 'picture', op.get(req, ['user', 'photos', 0, 'value']))

    res.send({
        result: user,
        version: APP_VERSION,
        started: APP_STARTED
    })
})



module.exports = router
