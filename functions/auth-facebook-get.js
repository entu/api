'use strict'

console.log('Loading function')

const _ = require('lodash')
const _h = require('./_helpers')
const async = require('async')
const https = require('https')
const querystring = require('querystring')



exports.handler = (event, context, callback) => {
  context.callbackWaitsForEmptyEventLoop = false

  if (!_.has(event, 'queryStringParameters.code') && !_.has(event, 'queryStringParameters.error')) {
    const query = querystring.stringify({
      client_id: process.env.FACEBOOK_ID,
      redirect_uri: `https://${event.headers.Host}${event.path}`,
      response_type: 'code',
      scope: 'public_profile,email',
      state: _.get(event, 'queryStringParameters.next')
    })

    return callback(null, _h.redirect(`https://www.facebook.com/dialog/oauth?${query}`, 302))
  } else if (_.has(event, 'queryStringParameters.error')) {
    return callback(null, _h.error(event.queryStringParameters.error_description))
  } else {
    async.waterfall([
      (callback) => {
        getToken(event, callback)
      },
      (accessToken, callback) => {
        getProfile(accessToken, callback)
      },
      (profile, callback) => {
        const user = {
          provider: 'facebook',
          id: _.get(profile, 'id'),
          name: _.get(profile, 'name'),
          email: _.get(profile, 'email'),
          picture: _.get(profile, 'picture.data.url')
        }
        _h.addUserSession(user, callback)
      }
    ], (err, sessionId) => {
      if(err) { return callback(null, _h.error(err)) }

      if (_.has(event, 'queryStringParameters.state')) {
        callback(null, _h.redirect(`${event.queryStringParameters.state}${sessionId}`, 302))
      } else {
        callback(null, _h.json({ key: sessionId }))
      }

      return callback(null, _h.json({ key: sessionId }))
    })
  }
}



const getToken = (event, callback) => {
  const query = querystring.stringify({
    client_id: process.env.FACEBOOK_ID,
    client_secret: process.env.FACEBOOK_SECRET,
    redirect_uri: `https://${event.headers.Host}${event.path}`,
    code: event.queryStringParameters.code
  })

  https.get(`https://graph.facebook.com/oauth/access_token?${query}`, (res) => {
    let data = ''

    res.on('data', (chunk) => {
      data += chunk
    })

    res.on('end', () => {
      data = JSON.parse(data)

      if (res.statusCode === 200 && data.access_token) {
        callback(null, data.access_token)
      } else {
        callback(_.get(data, 'error.message', data))
      }
    })
  }).on('error', callback)
}



const getProfile = (accessToken, callback) => {
  const query = querystring.stringify({
    access_token: accessToken,
    fields: 'id,name,email,picture'
  })

  https.get(`https://graph.facebook.com/me?${query}`, (res) => {
    let data = ''

    res.on('data', (chunk) => {
      data += chunk
    })

    res.on('end', () => {
      data = JSON.parse(data)

      if (res.statusCode === 200) {
        callback(null, data)
      } else {
        callback(_.get(data, 'error.message', data))
      }
    })
  }).on('error', callback)
}
