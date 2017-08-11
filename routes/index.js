'use strict'

const router = require('express').Router()



router.get('/', function (req, res) {
    res.respond(true)
})



router.get('/test', function () {
    throw new Error('böö')
})



module.exports = router
