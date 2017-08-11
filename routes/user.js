'use strict'

const async  = require('async')
const router = require('express').Router()

const entu   = require('../helpers/entu')



router.get('/', function (req, res, next) {
    res.respond(req.user)
})



module.exports = router
