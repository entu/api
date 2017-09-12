'use strict'

const _ = require('lodash')
const router = require('express').Router()

const entu = require('../../helpers/entu')



router.get('/', (req, res, next) => {
    let parts = _.get(req, 'headers.authorization', '').split(' ')

    if(parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') { return next([400, 'No API key']) }

    let user = {
        provider: 'entu',
        id: parts[1]
    }

    entu.addUserSession({
        request: req,
        user: user
    }, (err, sessionId) => {
        if(err) { return next(err) }

        if(req.query.next) {
            res.redirect(req.query.next + '?session=' + sessionId)
        } else {
            res.redirect('/session/' + sessionId)
        }
    })
})



module.exports = router
