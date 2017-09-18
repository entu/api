'use strict'

const _ = require('lodash')
const fs = require('fs')
const passport = require('passport')
const router = require('express').Router()
const saml = require('passport-saml').Strategy

const entu = require('../../helpers')



passport.use(new saml({
        entryPoint: process.env.TAAT_ENTRYPOINT,
        issuer: process.env.TAAT_ISSUER,
        cert: fs.readFileSync(process.env.TAAT_CERT, 'utf-8'),
        privateCert: fs.readFileSync(process.env.TAAT_PRIVATECERT, 'utf-8')
    },
    (profile, done) => {
        process.nextTick(() => {
            return done(null, profile)
        })
    }
))



router.get('/', (req, res) => {
    res.clearCookie('redirect')
    res.clearCookie('session')

    if(req.query.next) {
        res.cookie('redirect', req.query.next, {
            maxAge: 10 * 60 * 1000
        })
    }

    res.redirect('/auth/taat/auth')
})



router.get('/auth', passport.authenticate('saml', { scope: [], session: false }), () => {

})



router.post('/', passport.authenticate('saml', { failureRedirect: '/login', session: false }), (req, res, next) => {
    _.del(req, ['user', '_json'])
    _.del(req, ['user', '_raw'])

    var user = {}
    _.set(user, 'provider', 'taat.' + _.get(req, ['user', 'schacHomeOrganization']))
    _.set(user, 'id', _.get(req, ['user', 'urn:mace:dir:attribute-def:eduPersonTargetedID']))
    _.set(user, 'name', _.get(req, ['user', 'urn:mace:dir:attribute-def:cn']))
    _.set(user, 'email', _.get(req, ['user', 'urn:mace:dir:attribute-def:mail']))

    entu.addUserSession({
        request: req,
        user: user
    }, (err, sessionId) => {
        if(err) { return next(err) }

        var redirectUrl = req.cookies.redirect
        if(redirectUrl) {
            res.clearCookie('redirect')
            res.redirect(redirectUrl + '?key=' + sessionId)
        } else {
            res.json({ key: sessionId})
        }
    })
})



module.exports = router
