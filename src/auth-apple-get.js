'use strict'

const _ = require('lodash')
const _h = require('./_helpers')
const https = require('https')
const jwt = require('jsonwebtoken')
const querystring = require('querystring')

exports.handler = async (event, context) => {
  if (event.source === 'aws.events') { return }

  const appleId = await _h.ssmParameter('entu-api-apple-id')

  try {
    if (!_.has(event, 'queryStringParameters.code') && !_.has(event, 'queryStringParameters.error')) {
      const query = querystring.stringify({
        client_id: appleId,
        redirect_uri: `https://${event.headers.Host}${event.path}`,
        response_type: 'code',
        scope: 'name email',
        state: _.get(event, 'queryStringParameters.next')
      })

      return _h.redirect(`https://appleid.apple.com/auth/authorize?${query}`, 302)
    } else if (_.has(event, 'queryStringParameters.error')) {
      return _h.error(event.queryStringParameters.error_description)
    } else {
      const accessToken = await getToken(event)
      // const profile = await getProfile(accessToken)
      // const user = {
      //   provider: 'apple',
      //   id: _.get(profile, 'id'),
      //   name: _.get(profile, 'displayName'),
      //   email: _.get(profile, 'emails.0.value'),
      //   picture: _.get(profile, 'image.url')
      // }
      // const sessionId = await _h.addUserSession(user)
      //
      // if (_.has(event, 'queryStringParameters.state')) {
      //   return _h.redirect(`${event.queryStringParameters.state}${sessionId}`, 302)
      // } else {
        return _h.json({ key: accessToken })
      // }
    }
  } catch (e) {
    return _h.error(e)
  }
}

const getToken = async (event) => {
  const appleId = await _h.ssmParameter('entu-api-apple-id')
  const appleTeam = await _h.ssmParameter('entu-api-apple-team')
  const appleSecret = await _h.ssmParameter('entu-api-apple-secret')

  const appleJwt = jwt.sign({}, appleSecret, {
    issuer: appleTeam,
    audience: 'https://appleid.apple.com',
    subject: appleId,
    expiresIn: '60s',
    algorithm: 'ES256'
  })

  return new Promise((resolve, reject) => {
    const query = querystring.stringify({
      client_id: appleId,
      client_secret: appleJwt,
      redirect_uri: `https://${event.headers.Host}${event.path}`,
      code: event.queryStringParameters.code,
      grant_type: 'authorization_code'
    })

    const options = {
      host: 'appleid.apple.com',
      port: 443,
      method: 'POST',
      path: '/auth/token',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': query.length
      }
    }

    https.request(options, (res) => {
      let data = ''

      res.on('data', (chunk) => {
        data += chunk
      })

      res.on('end', () => {
        data = JSON.parse(data)

        if (res.statusCode === 200 && data.access_token) {
          resolve(data.access_token)
        } else {
          reject(_.get(data, 'error_description', data))
        }
      })
    }).on('error', err => {
      reject(err)
    }).write(query)
  })
}
