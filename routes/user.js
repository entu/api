'use strict'

const router = require('express').Router()



router.get('/', function (req, res) {
    res.respond(req.user)
})



module.exports = router
