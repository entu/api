'use strict'

const router = require('express').Router()



router.get('/', (req, res) => {
    res.respond(true)
})



router.get('/test', () => {
    throw new Error('böö')
})



module.exports = router
