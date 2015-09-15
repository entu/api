var router   = require('express').Router()
var passport = require('passport')
var saml     = require('passport-saml').Strategy
var op       = require('object-path')
var fs       = require('fs')



passport.use(new saml({
        entryPoint: SAML_ENTRYPOINT,
        issuer: SAML_ISSUER,
        cert: fs.readFileSync(SAML_CERT, 'utf-8'),
        privateCert: fs.readFileSync(SAML_PRIVATECERT, 'utf-8')
    },
    function(accessToken, refreshToken, profile, done) {
        process.nextTick(function () {
            return done(null, profile)
        })
    }
))



router.get('/', passport.authenticate('saml', { scope: [], session: false }), function(req, res, next) {

})



router.post('/', passport.authenticate('saml', { failureRedirect: '/login', session: false }), function(req, res, next) {
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
