'use strict'

const _ = require('lodash')
const google = require('passport-google-oauth').OAuth2Strategy
const passport = require('passport')
const router = require('express').Router()

const entu = require('../../helpers')



passport.use(new google({
    clientID: process.env.GOOGLE_ID,
    clientSecret: process.env.GOOGLE_SECRET,
    callbackURL: '/auth/google/callback',
    proxy: true
}, (accessToken, refreshToken, profile, done) => {
    process.nextTick(() => {
        return done(null, profile)
    })
}))



router.get('/', (req, res) => {
    res.clearCookie('redirect')
    res.clearCookie('session')

    if(req.query.next) {
        res.cookie('redirect', req.query.next, {
            maxAge: 10 * 60 * 1000
        })
    }

    res.redirect('/auth/google/auth')
})



router.get('/auth', passport.authenticate('google', { scope: ['https://www.googleapis.com/auth/userinfo.profile', 'https://www.googleapis.com/auth/userinfo.email'], session: false }), () => {

})



router.get('/callback', passport.authenticate('google', { failureRedirect: '/login', session: false }), (req, res, next) => {
    let user = {}
    const name = _.compact([
        _.get(req, 'user.name.givenName'),
        _.get(req, 'user.name.middleName'),
        _.get(req, 'user.name.familyName')
    ]).join(' ')

    _.set(user, 'provider', 'google')
    _.set(user, 'id', _.get(req, 'user.id'))
    _.set(user, 'name', name)
    _.set(user, 'email', _.get(req, 'user.emails.0.value'))
    _.set(user, 'picture', _.get(req, 'user.photos.0.value').replace('?sz=50', ''))

    entu.addUserSession({
        request: req,
        user: user
    }, (err, sessionId) => {
        if(err) { return next(err) }

        const redirectUrl = req.cookies.redirect
        if(redirectUrl) {
            res.clearCookie('redirect')
            res.redirect(`${redirectUrl}?key=${sessionId}`)
        } else {
            res.json({ key: sessionId})
        }
    })
})



module.exports = router
