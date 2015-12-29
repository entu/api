if(process.env.NEW_RELIC_LICENSE_KEY) { require('newrelic') }

var _        = require('underscore')
var bparser  = require('body-parser')
var cparser  = require('cookie-parser')
var express  = require('express')
var passport = require('passport')
var raven    = require('raven')

var entu     = require('./helpers/entu')



// global variables (and list of all used environment variables)
APP_VERSION        = process.env.VERSION || require('./package').version
APP_STARTED        = new Date().toISOString()
APP_PORT           = process.env.PORT || 3000
APP_COOKIE_DOMAIN  = process.env.COOKIE_DOMAIN || ''
APP_MONGODB        = process.env.MONGODB || 'mongodb://entu_mongodb:27017/'

GOOGLE_ID = process.env.GOOGLE_ID
GOOGLE_SECRET = process.env.GOOGLE_SECRET

FACEBOOK_ID = process.env.FACEBOOK_ID
FACEBOOK_SECRET = process.env.FACEBOOK_SECRET

TWITTER_KEY = process.env.TWITTER_KEY
TWITTER_SECRET = process.env.TWITTER_SECRET

LIVE_ID = process.env.LIVE_ID
LIVE_SECRET = process.env.LIVE_SECRET

TAAT_ENTRYPOINT = process.env.TAAT_ENTRYPOINT
TAAT_ISSUER = process.env.TAAT_ISSUER
TAAT_CERT = process.env.TAAT_CERT
TAAT_PRIVATECERT = process.env.TAAT_PRIVATECERT



// passport (de)serialize
passport.serializeUser(function(user, done) {
    done(null, user)
})

passport.deserializeUser(function(user, done) {
    done(null, user)
})



// initialize getsentry.com client
var ravenClient = new raven.Client({
    release: APP_VERSION,
    dataCallback: function(data) {
        delete data.request.env
        return data
    }
})



// start express app
var app = express()

// get correct client IP behind nginx
app.set('trust proxy', true)

// logs to getsentry.com - start
app.use(raven.middleware.express.requestHandler(ravenClient))

// Initialize Passport
app.use(passport.initialize())

// parse Cookies
app.use(cparser())

// parse POST requests
app.use(bparser.json())
app.use(bparser.urlencoded({extended: true}))

// save request info to request collection
app.use(function(req, res, next) {
    var start = Date.now()

    res.on('finish', function() {
        var r = {
            date     : new Date(),
            ip       : req.ip,
            duration : Date.now() - start,
            status   : res.statusCode,
            method   : req.method,
            host     : req.hostname,
            browser  : req.headers['user-agent'],
        }
        if(req.path) { r.path = req.path }
        if(!_.isEmpty(req.query)) { r.query = req.query }
        if(!_.isEmpty(req.body)) { r.body = req.body }
        if(req.browser) { r.browser = req.headers['user-agent'] }

        entu.requestLog(r, function(err, item) {
            if(err) next(err)
        })
    })

    next()
})

// routes mapping
app.use('/', require('./routes/index'))
app.use('/exit', require('./routes/exit'))

// provider mapping (only if configured)
if(GOOGLE_ID && GOOGLE_SECRET) { app.use('/google', require('./routes/google')) }
if(FACEBOOK_ID && FACEBOOK_SECRET) { app.use('/facebook', require('./routes/facebook')) }
if(TWITTER_KEY && TWITTER_SECRET) { app.use('/twitter', require('./routes/twitter')) }
if(LIVE_ID && LIVE_SECRET) { app.use('/live', require('./routes/live')) }
if(TAAT_ENTRYPOINT && TAAT_CERT && TAAT_PRIVATECERT) { app.use('/taat', require('./routes/taat')) }

// logs to getsentry.com - error
app.use(raven.middleware.express.errorHandler(ravenClient))

// show error
app.use(function(err, req, res) {
    res.send({
        error: err.message,
        version: APP_VERSION,
        started: APP_STARTED
    })

    if(err.status !== 404) { console.log(err) }
})



// start server
app.listen(APP_PORT, function() {
    console.log(new Date().toString() + ' started listening port ' + APP_PORT)
})
