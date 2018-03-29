'use strict'

console.log('Loading function')

const _ = require('lodash')
const _h = require('./_helpers')
const async = require('async')
const mysql = require('mysql')



exports.handler = (event, context, callback) => {
    context.callbackWaitsForEmptyEventLoop = false

    const cookies = _.get(event,'header.Cookie', '').split(';')
    const session = cookies.filter(x => x.startsWith('session='))[0]

    callback(null, _h.json({ x: session }))
}
