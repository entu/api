'use strict'

const _ = require('lodash')
const async = require('async')
const router = require('express').Router()
const soap = require('soap')

const entu = require('../../helpers/entu')



router.get('/', (req, res) => {
    res.redirect('https://id.entu.ee/auth/id-card/callback')
})



router.get('/callback', (req, res, next) => {
    console.log(JSON.stringify(req.headers, null, '  '))

    async.waterfall([
        (callback) => {
            if (req.headers.ssl_client_verify === 'SUCCESS' && req.headers.ssl_client_cert) {
                return callback(null)
            } else {
                return callback('ID-Card reading error')
            }
        },
        (callback) => {
            soap.createClient('https://digidocservice.sk.ee/?wsdl', {}, callback)
        },
        (client, callback) => {
            client.CheckCertificate({ Certificate: req.headers.ssl_client_cert }, (err, result) => {
                if(err) { return callback(err) }

                return callback(null, result)
            })
        },
        (result, callback) => {
            console.log(JSON.stringify(result, null, '  '))

            if(_.get(result, ['Status', '$value']) !== 'GOOD') { return callback('Not valid ID-Card') }
            if(!_.get(result, ['UserIDCode', '$value'])) { return callback('Not ID code') }

            var user = {}
            var name = _.compact([
                _.get(result, ['UserGivenname', '$value']),
                _.get(result, ['UserSurname', '$value'])
            ]).join(' ')

            _.set(user, 'provider', 'id-card')
            _.set(user, 'id', _.get(result, ['UserIDCode', '$value']))
            _.set(user, 'name', name)
            _.set(user, 'email', _.get(result, ['UserIDCode', '$value']) + '@eesti.ee')

            entu.addUserSession({ request: req, user: user }, callback)
        }
    ], (err, sessionId) => {
        if(err) { return next(err) }

        var redirectUrl = req.cookies.redirect
        if(redirectUrl) {
            res.clearCookie('redirect')
            res.redirect(redirectUrl + '?session=' + sessionId)
        } else {
            res.redirect('/session/' + sessionId)
        }
    })
})



module.exports = router
