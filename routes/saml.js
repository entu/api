var router   = require('express').Router()
var passport = require('passport')
var saml = require('passport-saml').Strategy



passport.use(new saml({
        path: '/saml/callback',
        entryPoint: 'https://openidp.feide.no/simplesaml/saml2/idp/SSOService.php',
        issuer: 'passport-saml'
    },
    function(accessToken, refreshToken, profile, done) {
        process.nextTick(function () {
            console.log(profile)

            return done(null, profile)
        })
    }
))



router.get('/', passport.authenticate('saml', { scope: [] }), function(req, res, next) {

})



router.get('/callback', passport.authenticate('saml', { failureRedirect: '/login' }), function(req, res, next) {
    res.redirect('/user')
})



module.exports = router
