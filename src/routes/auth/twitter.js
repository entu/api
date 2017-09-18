'use strict'

const _ = require('lodash')
const passport = require('passport')
const router = require('express').Router()
const twitter = require('passport-twitter').Strategy

const entu = require('../../helpers')



passport.use(new twitter({
        consumerKey: process.env.TWITTER_KEY,
        consumerSecret: process.env.TWITTER_SECRET,
        callbackURL: '/auth/twitter/callback',
        proxy: true
    },
    (token, tokenSecret, profile, done) => {
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

    res.redirect('/auth/twitter/auth')
})



router.get('/auth', passport.authenticate('twitter'), () => {

})



router.get('/callback', passport.authenticate('twitter', { failureRedirect: '/login' }), (req, res, next) => {
    var user = {}
    var name = _.compact([
        _.get(req, 'user.name.givenName'),
        _.get(req, 'user.name.middleName'),
        _.get(req, 'user.name.familyName')
    ]).join(' ')

    _.set(user, 'provider', 'twitter')
    _.set(user, 'id', _.get(req, 'user.id'))
    _.set(user, 'name', name)
    _.set(user, 'email', _.get(req, 'user.emails.0.value'))
    _.set(user, 'picture', _.get(req, 'user.photos.0.value'))

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
