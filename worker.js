'use strict'

if(process.env.NEW_RELIC_LICENSE_KEY) { require('newrelic') }

const _ = require('lodash')
const async = require('async')
const bparser = require('body-parser')
const cparser = require('cookie-parser')
const express = require('express')
const jwt = require('jsonwebtoken')
const passport = require('passport')
const raven = require('raven')

const entu = require('./helpers/entu')



// global variables (and list of all used environment variables)
const APP_VERSION = process.env.VERSION || process.env.HEROKU_SLUG_COMMIT.substr(0, 7) || require('./package').version
const APP_STARTED = new Date().toISOString()

// MONGODB
// CUSTOMERS
// JWT_SECRET

// GOOGLE_ID
// GOOGLE_SECRET

// FACEBOOK_ID
// FACEBOOK_SECRET

// TWITTER_KEY
// TWITTER_SECRET

// LIVE_ID
// LIVE_SECRET

// TAAT_ENTRYPOINT
// TAAT_ISSUER
// TAAT_CERT
// TAAT_PRIVATECERT



// passport (de)serialize
passport.serializeUser((user, done) => {
    done(null, user)
})

passport.deserializeUser((user, done) => {
    done(null, user)
})



// initialize getsentry.com client
if(process.env.SENTRY_DSN) {
    raven.config(process.env.SENTRY_DSN, {
        release: process.env.VERSION || process.env.HEROKU_SLUG_COMMIT || require('./package').version,
        dataCallback: (data) => {
            delete data.request.env
            return data
        }
    }).install()
}



// start express app
var app = express()

// set locals

// returns db connection (creates if not set)
app.locals.dbs = {}
app.locals.db = (customer, callback) => {
    if(_.has(app, ['locals', 'dbs', customer])) {
        return callback(null, app.locals.dbs[customer])
    } else {
        var entuDb
        async.waterfall([
            (callback) => {
                mongo.MongoClient.connect(process.env.MONGODB, { ssl: true, sslValidate: true }, callback)
            },
            (connection, callback) => {
                entuDb = connection
                entuDb.collection('entity').findOne({ 'database_name.string': customer, 'mongodb.string': { '$exists': true }, deleted_at: { '$exists': false }, deleted_by: { '$exists': false } }, { _id: false, 'mongodb.string': true }, callback)
            },
            (url, callback) => {
                entuDb.close()

                let mongoUrl = url.mongodb[0].string

                if (!mongoUrl) { return callback('No MongoDb url')}

                mongo.MongoClient.connect(mongoUrl, { ssl: true, sslValidate: true }, callback)
            },
        ], (err, connection) => {
            if(err) { return callback(err) }

            console.log('Connected to ' + customer)

            connection.on('close', () => {
                delete app.locals.dbs[customer]
                console.log('Disconnected from ' + customer)
            })

            app.locals.dbs[customer] = connection
            return callback(null, app.locals.dbs[customer])
        })
    }
}

// Hide Powered By
app.disable('x-powered-by')

// get correct client IP behind nginx
app.set('trust proxy', true)

// logs to getsentry.com - start
if(process.env.SENTRY_DSN) {
    app.use(raven.requestHandler())
}

// Initialize Passport
app.use(passport.initialize())

// parse Cookies
app.use(cparser())

// parse POST requests
app.use(bparser.json())
app.use(bparser.urlencoded({extended: true}))

// save request info to request collection
app.use((req, res, next) => {
    req.startDt = Date.now()

    res.on('finish', () => {
        var request = {
            date: new Date(),
            ip: req.ip,
            ms: Date.now() - req.startDt,
            status: res.statusCode,
            method: req.method,
            host: req.hostname,
            browser: req.headers['user-agent'],
        }
        if(req.path) { request.path = req.path }
        if(!_.isEmpty(req.query)) { request.query = req.query }
        if(!_.isEmpty(req.body)) { request.body = req.body }
        if(req.browser) { request.browser = req.headers['user-agent'] }

        async.waterfall([
            (callback) => {
                req.app.locals.db('entu', callback)
            },
            (connection, callback) => {
                connection.collection('request').insertOne(request, callback)
            },
        ], (err) => {
            if(err) {
                console.error('Can\'t save request: ' + err.toString())
            }
        })
    })

    next(null)
})

//custom JSON output
app.use((req, res, next) => {
    res.respond = (body, errorCode) => {
        var message = {
            release: APP_VERSION,
            startDt: APP_STARTED,
            ms: Date.now() - req.startDt,
            auth: !!req.user
        }

        if (errorCode) {
            message.error = {
                code: errorCode,
                message: body
            }
            res.status(errorCode).json(message)
        } else {
            if (body.constructor === Array) {
                message.count = body.length
            }
            message.result = body
            res.json(message)
        }
    }

    next(null)
})

// check JWT
app.use((req, res, next) => {
    var parts = _.get(req, 'headers.authorization', '').split(' ')
    let jwtConf = {
        issuer: req.hostname
    }

    if (req.query.customer) {
        req.customer = req.query.customer
        jwtConf.audience = req.query.customer
    }

    if(parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') { return next(null) }

    jwt.verify(parts[1], process.env.JWT_SECRET, jwtConf, (err, decoded) => {
        if(err) { return next([401, err]) }

        _.set(req, 'user', decoded.sub)
        _.set(req, 'customer', decoded.aud)

        next(null)
    })
})

// redirect HTTP to HTTPS
app.use((req, res, next) => {
    if (req.hostname !== 'localhost' && req.protocol.toLowerCase() !== 'https') { next([418, 'I\'m a teapot']) } else { next() }
})

// routes mapping
app.use('/', require('./routes/index'))
app.use('/auth', require('./routes/auth/index'))
app.use('/user', require('./routes/user'))
app.use('/entity', require('./routes/entity'))

// provider mapping (only if configured)
app.use('/auth/id-card', require('./routes/auth/id-card'))

if(process.env.GOOGLE_ID && process.env.GOOGLE_SECRET) { app.use('/auth/google', require('./routes/auth/google')) }
if(process.env.FACEBOOK_ID && process.env.FACEBOOK_SECRET) { app.use('/auth/facebook', require('./routes/auth/facebook')) }
if(process.env.TWITTER_KEY && process.env.TWITTER_SECRET) { app.use('/auth/twitter', require('./routes/auth/twitter')) }
if(process.env.LIVE_ID && process.env.LIVE_SECRET) { app.use('/auth/live', require('./routes/auth/live')) }
if(process.env.TAAT_ENTRYPOINT && process.env.TAAT_CERT && process.env.TAAT_PRIVATECERT) { app.use('/auth/taat', require('./routes/auth/taat')) }

// logs to getsentry.com - error
if(process.env.SENTRY_DSN) {
    app.use(raven.errorHandler())
}

// show 404
app.use((req, res, next) => {
    next([404, 'Not found'])
})

// show error
app.use((err, req, res, next) => {
    if (err.constructor === Array) {
        res.respond(err[1], err[0])
    } else {
        res.respond(err.toString(), 500)
    }
})

// start server
app.listen(process.env.PORT, () => {
    console.log(new Date().toString() + ' started listening port ' + process.env.PORT)
})
