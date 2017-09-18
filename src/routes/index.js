'use strict'

const router = require('express').Router()

const startDt = new Date()



router.get('/', (req, res) => {
    res.json({
        release: process.env.VERSION || process.env.HEROKU_SLUG_COMMIT.substr(0, 7) || require('./package').version,
        startDt: startDt,
    })
})



router.get('/timeout', (req, res) => {
    setTimeout(() => {
        res.json(true)
    }, 10000)
})



router.get('/error', () => {
    throw new Error('böö')
})



module.exports = router
