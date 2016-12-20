var _      = require('underscore')
var async  = require('async')
var op     = require('object-path')
var router = require('express').Router()
var soap   = require('soap')

var entu   = require('../../helpers/entu')



router.get('/', function(req, res) {
    res.redirect('https://id.entu.ee/auth/id-card/callback')
})



router.get('/callback', function(req, res, next) {
    async.waterfall([
        function (callback) {
            if (req.headers.ssl_client_verify === 'SUCCESS' && req.headers.ssl_client_cert) {
                callback(null)
            } else {
                callback(new Error('ID-Card reading error'))
            }
        },
        function (callback) {
            soap.createClient('https://digidocservice.sk.ee/?wsdl', callback)
        },
        function (client, callback) {
            client.CheckCertificate({ Certificate: req.headers.ssl_client_cert }, callback)
        },
        function (result, callback) {
            if(op.get(result, ['Status', '$value']) !== 'GOOD') { return callback(new Error('Not valid ID-Card')) }

            var user = {}
            var name = _.compact([
                op.get(result, ['UserGivenname', '$value']),
                op.get(result, ['UserSurname', '$value'])
            ]).join(' ')

            op.set(user, 'provider', 'id-card')
            op.set(user, 'id', op.get(result, ['UserIDCode', '$value']))
            op.set(user, 'name', name)

            entu.addUserSession({ request: req, user: user }, function (err, sessionId) {
                if (err) { return callback(err) }

                callback(null, sessionId)
            })
        }
    ], function (err, sessionId) {
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
