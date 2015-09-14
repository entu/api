var router   = require('express').Router()
var passport = require('passport')
var google   = require('passport-google-oauth').OAuth2Strategy



passport.use(new google({
        clientID: GOOGLE_ID,
        clientSecret: GOOGLE_SECRET,
        callbackURL: '/google/callback',
        proxy: true
    },
    function(accessToken, refreshToken, profile, done) {
        process.nextTick(function () {
            console.log(profile)

            return done(null, profile)
        })
    }
))



router.get('/', passport.authenticate('google', { scope: ['https://www.googleapis.com/auth/userinfo.profile', 'https://www.googleapis.com/auth/userinfo.email'] }), function(req, res, next) {

})



router.get('/callback', passport.authenticate('google', { failureRedirect: '/login' }), function(req, res, next) {
    res.redirect('/user')
})



module.exports = router
