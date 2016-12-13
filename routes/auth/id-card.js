var _        = require('underscore')
var op       = require('object-path')
var router   = require('express').Router()

var entu   = require('../../helpers/entu')



router.get('/', function(req, res) {
    res.redirect('https://id.entu.ee/auth/id-card/callback')
})



router.get('/callback', function(req, res, next) {
    res.send(req.headers)
    // var user = {}
    // var name = _.compact([
    //     op.get(req, ['user', 'name', 'givenName']),
    //     op.get(req, ['user', 'name', 'middleName']),
    //     op.get(req, ['user', 'name', 'familyName'])
    // ]).join(' ')
    //
    // op.set(user, 'provider', 'facebook')
    // op.set(user, 'id', op.get(req, ['user', 'id']))
    // op.set(user, 'name', name)
    // op.set(user, 'email', op.get(req, ['user', 'emails', 0, 'value']))
    // op.set(user, 'picture', op.get(req, ['user', 'photos', 0, 'value']))
    //
    // entu.addUserSession({
    //     request: req,
    //     user: user
    // }, function(err, sessionId) {
    //     if(err) { return next(err) }
    //
    //     var redirectUrl = req.cookies.redirect
    //     if(redirectUrl) {
    //         res.clearCookie('redirect')
    //         res.redirect(redirectUrl + '?session=' + sessionId)
    //     } else {
    //         res.redirect('/auth/session/' + sessionId)
    //     }
    // })
})



module.exports = router
