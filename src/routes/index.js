'use strict'

const router = require('express').Router()



router.get('/', (req, res) => {
    res.respond(true)
})



router.get('/timeout', (req, res) => {
    setTimeout(() => {
        res.respond(true)
    }, 10000)
})



router.get('/error', () => {
    throw new Error('böö')
})



module.exports = router
