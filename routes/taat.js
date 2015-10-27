var router   = require('express').Router()
var passport = require('passport')
var saml     = require('passport-saml').Strategy
var op       = require('object-path')
var fs       = require('fs')

var entu   = require('../helpers/entu')



passport.use(new saml({
        entryPoint: TAAT_ENTRYPOINT,
        issuer: TAAT_ISSUER,
        cert: fs.readFileSync(TAAT_CERT, 'utf-8'),
        privateCert: fs.readFileSync(TAAT_PRIVATECERT, 'utf-8'),
        path: '/taat/callback'
    },
    function(profile, done) {
        process.nextTick(function () {
            return done(null, profile)
        })
    }
))



router.get('/', function(req, res, next) {
    res.clearCookie('redirect')
    res.clearCookie('session', {
        domain: APP_COOKIE_DOMAIN
    })

    if(req.query.next) {
        res.cookie('redirect', req.query.next, {
            maxAge: 60 * 60 * 1000
        })
    }

    res.redirect('/taat/auth')
})



router.get('/auth', passport.authenticate('saml', { scope: [], session: false }), function(req, res, next) {

})



router.post('/callback', passport.authenticate('saml', { failureRedirect: '/login', session: false }), function(req, res, next) {
    console.clog(req.user)

    var user = {}
    op.set(user, 'provider', 'taat.' + op.get(req, ['user', 'schacHomeOrganization']))
    op.set(user, 'id', op.get(req, ['user', 'urn:mace:dir:attribute-def:eduPersonTargetedID']))
    op.set(user, 'name', op.get(req, ['user', 'urn:mace:dir:attribute-def:cn']))
    op.set(user, 'email', op.get(req, ['user', 'urn:mace:dir:attribute-def:mail']))

    entu.session_start({
        request: req,
        response: res,
        user: user
    }, function(err, session) {
        if(err) return next(err)

        var redirect_url = req.cookies.redirect
        if(redirect_url) {
            res.cookie('session', session.session, {
                maxAge: 14 * 24 * 60 * 60 * 1000,
                domain: APP_COOKIE_DOMAIN
            })
            res.clearCookie('redirect')
            res.redirect(redirect_url)
        } else {
            res.send({
                result: session,
                version: APP_VERSION,
                started: APP_STARTED
            })
        }
    })
})



module.exports = router
