var _      = require('lodash')
var async  = require('async')
var op     = require('object-path')
var router = require('express').Router()
var soap   = require('soap')

var entu   = require('../../helpers/entu')



router.get('/', function(req, res) {
    res.redirect('https://id.entu.ee/auth/id-card/callback')
})



router.get('/callback', function(req, res, next) {
    console.log(JSON.stringify(req.headers, null, '  '))

    async.waterfall([
        function (callback) {
            if (req.headers.ssl_client_verify === 'SUCCESS' && req.headers.ssl_client_cert) {
                callback(null)
            } else {
                callback(new Error('ID-Card reading error'))
            }
        },
        function (callback) {
            soap.createClient('https://digidocservice.sk.ee/?wsdl', {}, callback)
        },
        function (client, callback) {
            client.CheckCertificate({ Certificate: req.headers.ssl_client_cert }, function(err, result) {
                if(err) { return callback(err) }

                callback(null, result)
            })
        },
        function (result, callback) {
            console.log(JSON.stringify(result, null, '  '))

            if(op.get(result, ['Status', '$value']) !== 'GOOD') { return callback(new Error('Not valid ID-Card')) }
            if(!op.get(result, ['UserIDCode', '$value'])) { return callback(new Error('Not ID code')) }

            var user = {}
            var name = _.compact([
                op.get(result, ['UserGivenname', '$value']),
                op.get(result, ['UserSurname', '$value'])
            ]).join(' ')

            op.set(user, 'provider', 'id-card')
            op.set(user, 'id', op.get(result, ['UserIDCode', '$value']))
            op.set(user, 'name', name)
            op.set(user, 'email', op.get(result, ['UserIDCode', '$value']) + '@eesti.ee')

            entu.addUserSession({ request: req, user: user }, callback)
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
