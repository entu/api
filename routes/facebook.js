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
        process.nextTick(function () {
            console.log(profile)

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
