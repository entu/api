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
            return done(null, profile)
        })
  }
))



router.get('/', passport.authenticate('facebook', { scope: ['email'], session: false }), function(req, res, next) {

})



router.get('/callback', passport.authenticate('facebook', { failureRedirect: '/login', session: false }), function(req, res, next) {
    console.log(req.user)
    res.redirect('/user')
})



module.exports = router
