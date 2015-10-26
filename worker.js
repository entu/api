if(process.env.NEW_RELIC_LICENSE_KEY) require('newrelic')

var express  = require('express')
var passport = require('passport')
var bparser  = require('body-parser')
var cparser  = require('cookie-parser')
var random   = require('randomstring')
var raven    = require('raven')



// global variables (and list of all used environment variables)
APP_VERSION       = process.env.VERSION || require('./package').version
APP_STARTED       = new Date().toISOString()
APP_PORT          = process.env.PORT || 3000
APP_COOKIE_SECRET = process.env.COOKIE_SECRET || random.generate(16)
APP_COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || ''

APP_MONGODB        = process.env.MONGODB

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
var raven_client = new raven.Client({
    release: APP_VERSION,
    dataCallback: function(data) {
        delete data.request.env
        return data
    }
})



// start express app
var app = express()

// logs to getsentry.com - start
app.use(raven.middleware.express.requestHandler(raven_client))

// Initialize Passport
app.use(passport.initialize())

// parse Cookies
app.use(cparser())

// parse POST requests
app.use(bparser.json())
app.use(bparser.urlencoded({extended: true}))

// provider mapping (only if configured)
if(GOOGLE_ID && GOOGLE_SECRET) app.use('/google', require('./routes/google'))
if(FACEBOOK_ID && FACEBOOK_SECRET) app.use('/facebook', require('./routes/facebook'))
if(TWITTER_KEY && TWITTER_SECRET) app.use('/twitter', require('./routes/twitter'))
if(LIVE_ID && LIVE_SECRET) app.use('/live', require('./routes/live'))
if(TAAT_ENTRYPOINT && TAAT_CERT && TAAT_PRIVATECERT) app.use('/taat', require('./routes/taat'))

// logs to getsentry.com - error
app.use(raven.middleware.express.errorHandler(raven_client))

// show error
app.use(function(err, req, res, next) {
    res.send({
        error: err.message,
        version: APP_VERSION,
        started: APP_STARTED
    })

    if(err.status !== 404) console.log(err)
})



// start server
app.listen(APP_PORT, function() {
    console.log(new Date().toString() + ' started listening port ' + APP_PORT)
})
