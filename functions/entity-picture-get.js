'use strict'

console.log('Loading function')

const _ = require('lodash')
const _h = require('./_helpers')
const async = require('async')
const mysql = require('mysql')



exports.handler = (event, context, callback) => {
    context.callbackWaitsForEmptyEventLoop = false

    callback(null, _h.json({ x: 1 }))
}
