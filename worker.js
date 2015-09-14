if(process.env.NEW_RELIC_LICENSE_KEY) require('newrelic')

var express = require('express')
var path    = require('path')
var fs      = require('fs')



// global variables (and list of all used environment variables)
APP_VERSION = require('./package').version
APP_STARTED = new Date().toISOString()
APP_PORT    = process.env.PORT || 3000

GOOGLE_ID = process.env.GOOGLE_ID
GOOGLE_SECRET = process.env.GOOGLE_SECRET

FACEBOOK_ID = process.env.FACEBOOK_ID
FACEBOOK_SECRET = process.env.FACEBOOK_SECRET



var app = express()
    // Initialize Passport!  Also use passport.session() middleware, to support
    .use(passport.initialize())


    // routes mapping
    .use('/user', require('./routes/user'))

// provider mapping (only if configured)
if(GOOGLE_ID && GOOGLE_SECRET) app.use('/google', require('./routes/google'))
if(FACEBOOK_ID && FACEBOOK_SECRET) app.use('/facebook', require('./routes/facebook'))



// show error
app.use(function(err, req, res, next) {
        var status = parseInt(err.status) || 500

        res.status(status)
        res.send({
            error: err.message,
            version: APP_VERSION,
            started: APP_STARTED
        })

        if(err.status !== 404) console.log(err)
    })



// start server
app.listen(APP_PORT)



console.log(new Date().toString() + ' started listening port ' + APP_PORT)
