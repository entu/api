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
            return done(null, profile)
        })
    }
))



router.get('/', passport.authenticate('google', { scope: ['https://www.googleapis.com/auth/userinfo.profile', 'https://www.googleapis.com/auth/userinfo.email'], session: false }), function(req, res, next) {

})



router.get('/callback', passport.authenticate('google', { failureRedirect: '/login', session: false }), function(req, res, next) {
    console.log(req.user)
    res.redirect('/user')
})



module.exports = router
