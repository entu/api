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
            return done(null, profile)
        })
    }
))



router.get('/', passport.authenticate('saml', { scope: [], session: false }), function(req, res, next) {

})



router.get('/callback', passport.authenticate('saml', { failureRedirect: '/login', session: false }), function(req, res, next) {
    console.log(req.user)
    res.redirect('/user')
})



module.exports = router
