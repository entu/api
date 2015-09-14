var router   = require('express').Router()
var passport = require('passport')
var facebook = FacebookStrategy = require('passport-facebook').Strategy



passport.use(new facebook({
        clientID: FACEBOOK_ID,
        clientSecret: FACEBOOK_SECRET,
        callbackURL: '/facebook/callback',
        proxy: true
    },
    function(accessToken, refreshToken, profile, done) {
    // asynchronous verification, for effect...
    process.nextTick(function () {

        // To keep the example simple, the user's Facebook profile is returned to
        // represent the logged-in user.  In a typical application, you would want
        // to associate the Facebook account with a user record in your database,
        // and return that user instead.
        return done(null, profile)
    })
  }
))



router.get('/', passport.authenticate('facebook', { scope: ['email'] }), function(req, res, next) {

})



router.get('/callback', passport.authenticate('facebook', { failureRedirect: '/login' }), function(req, res, next) {
    res.redirect('/user')
})



module.exports = router
