if(process.env.NEW_RELIC_LICENSE_KEY) { require('newrelic') }

var bparser    = require('body-parser')
var cparser    = require('cookie-parser')
var express    = require('express')
var expressJwt = require('express-jwt')
var passport   = require('passport')
var raven      = require('raven')

var entu       = require('./helpers/entu')



// global variables (and list of all used environment variables)
APP_VERSION        = process.env.VERSION || require('./package').version
APP_STARTED        = new Date().toISOString()
APP_PORT           = process.env.PORT || 3000
APP_MONGODB        = process.env.MONGODB || 'mongodb://entu_mongodb:27017/'
APP_JWT_SECRET     = process.env.JWT_SECRET || '123abc'

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

APP_ENTU_DBS = {}



// passport (de)serialize
passport.serializeUser(function(user, done) {
    done(null, user)
})

passport.deserializeUser(function(user, done) {
    done(null, user)
})



// initialize getsentry.com client
if(process.env.SENTRY_DSN) {
    var ravenClient = new raven.Client({
        release: APP_VERSION,
        dataCallback: function(data) {
            delete data.request.env
            return data
        }
    })
}



// start express app
var app = express()

// Hide Powered By
app.disable('x-powered-by')

// get correct client IP behind nginx
app.set('trust proxy', true)

// logs to getsentry.com - start
if(process.env.SENTRY_DSN) {
    app.use(raven.middleware.express.requestHandler(ravenClient))
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

// routes mapping
app.use('/', require('./routes/index'))
app.use('/auth', require('./routes/auth/index'))
app.use('/status', require('./routes/status'))
app.use('/user', require('./routes/user'))

// provider mapping (only if configured)
if(GOOGLE_ID && GOOGLE_SECRET) { app.use('/auth/google', require('./routes/auth/google')) }
if(FACEBOOK_ID && FACEBOOK_SECRET) { app.use('/auth/facebook', require('./routes/auth/facebook')) }
if(TWITTER_KEY && TWITTER_SECRET) { app.use('/auth/twitter', require('./routes/auth/twitter')) }
if(LIVE_ID && LIVE_SECRET) { app.use('/auth/live', require('./routes/auth/live')) }
if(TAAT_ENTRYPOINT && TAAT_CERT && TAAT_PRIVATECERT) { app.use('/auth/taat', require('./routes/auth/taat')) }

// logs to getsentry.com - error
if(process.env.SENTRY_DSN) {
    app.use(raven.middleware.express.errorHandler(ravenClient))
}

// show 404
app.use(function(req, res, next) {
    next([404, new Error('not found')])
})

// show error
app.use(function(err, req, res, next) {
    var code = 500
    var error = err
    if (err.constructor === Array) {
        code = err[0]
        error = err[1]
    }
    res.respond(error.toString(), code)
})

// start server
app.listen(APP_PORT, function() {
    console.log(new Date().toString() + ' started listening port ' + APP_PORT)
})
