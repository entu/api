if(process.env.NEW_RELIC_LICENSE_KEY) { require('newrelic') }

var bparser    = require('body-parser')
var cparser    = require('cookie-parser')
var express    = require('express')
var passport   = require('passport')
var raven      = require('raven')

var entu       = require('./helpers/entu')



// global variables (and list of all used environment variables)
APP_VERSION = process.env.VERSION || process.env.HEROKU_SLUG_COMMIT || require('./package').version
APP_STARTED = new Date().toISOString()
APP_PORT = process.env.PORT || 3000
APP_JWT_SECRET = process.env.JWT_SECRET || '123abc'

APP_MONGODB = process.env.MONGODB || 'mongodb://entu_mongodb:27017/'
APP_CUSTOMERS = process.env.CUSTOMERS.split(',') || []

APP_DBS = {}

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
passport.serializeUser(function (user, done) {
    done(null, user)
})

passport.deserializeUser(function (user, done) {
    done(null, user)
})



// initialize getsentry.com client
if(process.env.SENTRY_DSN) {
    raven.config(process.env.SENTRY_DSN, {
        release: APP_VERSION,
        dataCallback: function (data) {
            delete data.request.env
            return data
        }
    }).install()
}



// start express app
var app = express()

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

// save request info to request collection, check JWT, custom JSON output
app.use(entu.requestLog)
app.use(entu.customResponder)
app.use(entu.jwtCheck)

// Redirect HTTP to HTTPS
app.use(function (req, res, next) {
    if (req.protocol.toLowerCase() !== 'https') { next([418, 'I\'m a teapot']) }
})

// routes mapping
app.use('/', require('./routes/index'))
app.use('/auth', require('./routes/auth/index'))
app.use('/user', require('./routes/user'))
app.use('/entity', require('./routes/entity'))

// provider mapping (only if configured)
app.use('/auth/id-card', require('./routes/auth/id-card'))

if(GOOGLE_ID && GOOGLE_SECRET) { app.use('/auth/google', require('./routes/auth/google')) }
if(FACEBOOK_ID && FACEBOOK_SECRET) { app.use('/auth/facebook', require('./routes/auth/facebook')) }
if(TWITTER_KEY && TWITTER_SECRET) { app.use('/auth/twitter', require('./routes/auth/twitter')) }
if(LIVE_ID && LIVE_SECRET) { app.use('/auth/live', require('./routes/auth/live')) }
if(TAAT_ENTRYPOINT && TAAT_CERT && TAAT_PRIVATECERT) { app.use('/auth/taat', require('./routes/auth/taat')) }

// logs to getsentry.com - error
if(process.env.SENTRY_DSN) {
    app.use(raven.errorHandler())
}

// show 404
app.use(function (req, res, next) {
    next([404, 'Not found'])
})

// show error
app.use(function (err, req, res, next) {
    var code = 500
    var error = err
    if (err.constructor === Array) {
        code = err[0]
        error = err[1]
    }
    res.respond(error.toString(), code)
})

// start server
app.listen(APP_PORT, function () {
    console.log(new Date().toString() + ' started listening port ' + APP_PORT)
})
