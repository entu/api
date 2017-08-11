'use strict'

const router = require('express').Router()



router.get('/', (req, res) => {
    res.respond(req.user)
})



module.exports = router
