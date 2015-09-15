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
    function(profile, done) {
        process.nextTick(function () {
            return done(null, profile)
        })
    }
))



router.get('/', passport.authenticate('saml', { scope: [], session: false }), function(req, res, next) {

})



router.post('/', passport.authenticate('saml', { failureRedirect: '/login', session: false }), function(req, res, next) {
    var user = {}
    op.set(user, 'provider', 'taat@' + op.get(req, ['user', 'schacHomeOrganization']))
    op.set(user, 'id', op.get(req, ['user', 'urn:mace:dir:attribute-def:eduPersonTargetedID']))
    op.set(user, 'name', op.get(req, ['user', 'urn:mace:dir:attribute-def:cn']))
    op.set(user, 'email', op.get(req, ['user', 'urn:mace:dir:attribute-def:mail']))
    op.set(user, 'raw', op.get(req, ['user']))

    res.send({
        result: user,
        version: APP_VERSION,
        started: APP_STARTED
    })
})



module.exports = router
