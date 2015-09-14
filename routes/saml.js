var router   = require('express').Router()
var passport = require('passport')
var saml = require('passport-saml').Strategy



passport.use(new saml({
        path: '/saml/callback',
        entryPoint: 'https://openidp.feide.no/simplesaml/saml2/idp/SSOService.php',
        issuer: 'passport-saml'
    },
    function(accessToken, refreshToken, profile, done) {
        // asynchronous verification, for effect...
        process.nextTick(function () {

            // To keep the example simple, the user's Google profile is returned to
            // represent the logged-in user.  In a typical application, you would want
            // to associate the Google account with a user record in your database,
            // and return that user instead.
            return done(null, profile)
        })
    }
))



router.get('/', passport.authenticate('saml', { scope: [] }), function(req, res, next) {

})



router.get('/callback', passport.authenticate('saml', { failureRedirect: '/login' }), function(req, res) {
    res.redirect('/user')
})



module.exports = router
