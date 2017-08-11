'use strict'

const _ = require('lodash')
const facebook = require('passport-facebook').Strategy
const passport = require('passport')
const router = require('express').Router()

const entu = require('../../helpers/entu')



passport.use(new facebook({
        clientID: process.env.FACEBOOK_ID,
        clientSecret: process.env.FACEBOOK_SECRET,
        callbackURL: '/auth/facebook/callback',
        profileFields: ['id', 'name', 'email', 'picture'],
        proxy: true
    },
    function (accessToken, refreshToken, profile, done) {
        process.nextTick(function () {
            return done(null, profile)
        })
  }
))



router.get('/', function (req, res) {
    res.clearCookie('redirect')
    res.clearCookie('session')

    if(req.query.next) {
        res.cookie('redirect', req.query.next, {
            maxAge: 10 * 60 * 1000
        })
    }

    res.redirect('/auth/facebook/auth')
})



router.get('/auth', passport.authenticate('facebook', { scope: ['public_profile', 'email'], session: false }), function () {

})



router.get('/callback', passport.authenticate('facebook', { failureRedirect: '/login', session: false }), function (req, res, next) {
    var user = {}
    var name = _.compact([
        _.get(req, ['user', 'name', 'givenName']),
        _.get(req, ['user', 'name', 'middleName']),
        _.get(req, ['user', 'name', 'familyName'])
    ]).join(' ')

    _.set(user, 'provider', 'facebook')
    _.set(user, 'id', _.get(req, ['user', 'id']))
    _.set(user, 'name', name)
    _.set(user, 'email', _.get(req, ['user', 'emails', 0, 'value']))
    _.set(user, 'picture', _.get(req, ['user', 'photos', 0, 'value']))

    entu.addUserSession({
        request: req,
        user: user
    }, function (err, sessionId) {
        if(err) { return next(err) }

        var redirectUrl = req.cookies.redirect
        if(redirectUrl) {
            res.clearCookie('redirect')
            res.redirect(redirectUrl + '?session=' + sessionId)
        } else {
            res.redirect('/auth/session/' + sessionId)
        }
    })
})



module.exports = router
