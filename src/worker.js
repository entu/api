'use strict'

if(process.env.NEW_RELIC_LICENSE_KEY) require('newrelic')

const _ = require('lodash')
const async = require('async')
const bparser = require('body-parser')
const cparser = require('cookie-parser')
const express = require('express')
const jwt = require('jsonwebtoken')
const mongo = require('mongodb')
const passport = require('passport')
const raven = require('raven')



// MONGODB
// ACCOUNTS
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
            _.unset(data, 'request.env')
            return data
        }
    }).install()
}



// start express app
var app = express()

// set locals

// returns db connection (creates if not set)
app.locals.dbs = {}
app.locals.db = (account, callback) => {
    if(_.has(app, ['locals', 'dbs', account])) {
        return callback(null, app.locals.dbs[account].db(account))
    } else {
        var entuDb
        async.waterfall([
            (callback) => {
                mongo.MongoClient.connect(process.env.MONGODB, { ssl: true, sslValidate: true }, callback)
            },
            (connection, callback) => {
                entuDb = connection
                entuDb.collection('entity').findOne({ 'database_name.string': account, 'mongodb.string': { $exists: true } }, { _id: false, 'mongodb.string': true }, callback)
            },
            (url, callback) => {
                if (!_.has(url, 'mongodb.0.string')) { return callback('No MongoDb url')}

                mongo.MongoClient.connect(_.get(url, 'mongodb.0.string'), { ssl: true, sslValidate: true }, callback)
            },
            (connection, callback) => {
                console.log('Connected to ' + account)

                connection.on('close', () => {
                    _.unset(app, ['locals', 'dbs', account])
                    console.log('Disconnected from ' + account)
                })

                app.locals.dbs[account] = connection

                entuDb.close(callback)
            },
        ], (err) => {
            if(err) { return callback(err) }

            return callback(null, app.locals.dbs[account].db(account))
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

// parse POST/PUT requests body
app.use(bparser.json())

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
        if(req.path) { request.path = req.originalUrl.split('?')[0] }
        if(!_.isEmpty(req.query)) { request.query = req.originalUrl.split('?')[1] }
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
        res.status(errorCode || 200).json(body)
    }

    next(null)
})

// redirect HTTP to HTTPS
app.use((req, res, next) => {
    if (req.hostname !== 'localhost' && req.protocol.toLowerCase() !== 'https') { next([418, 'I\'m a teapot']) } else { next() }
})

// check JWT
var jwtCheck = (req, res, next) => {
    var parts = _.get(req, 'headers.authorization', '').split(' ')
    let jwtConf = {
        issuer: req.hostname
    }

    if (req.query.account) {
        req.account = req.query.account
        jwtConf.audience = req.query.account
    }

    if(parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') { return next(null) }

    jwt.verify(parts[1], process.env.JWT_SECRET, jwtConf, (err, decoded) => {
        if(err) { return next([401, err]) }

        _.set(req, 'user', decoded.sub)
        _.set(req, 'account', decoded.aud)

        next(null)
    })
}

// routes mapping
app.use('/', require('./routes/index'))
app.use('/auth', require('./routes/auth/index'))
app.use('/auth/id-card', require('./routes/auth/id-card'))

app.use('/account', jwtCheck, require('./routes/account'))
app.use('/entity', jwtCheck, require('./routes/entity'))
app.use('/property', jwtCheck, require('./routes/property'))

// provider mapping (only if configured)
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
