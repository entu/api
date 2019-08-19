'use strict'

const _ = require('lodash')
const _h = require('../_helpers')
const https = require('https')
const jwt = require('jsonwebtoken')
const querystring = require('querystring')

exports.handler = async (event, context) => {
  if (event.source === 'aws.events') { return }

  try {
    const params = _.get(event, 'queryStringParameters') || {}

    const jwtSecret = await _h.ssmParameter('entu-api-jwt-secret')
    const googleId = await _h.ssmParameter('entu-api-google-id')

    if (params.error) {
      return _h.error(params.error_description)
    } else if (params.code && params.state) {
      const decodedState = jwt.verify(params.state, jwtSecret, { audience: _.get(event, 'requestContext.identity.sourceIp') })
      const accessToken = await getToken(event)
      const profile = await getProfile(accessToken)
      const user = {
        provider: 'google',
        id: _.get(profile, 'id'),
        name: _.get(profile, 'displayName'),
        email: _.get(profile, 'emails.0.value'),
        picture: _.get(profile, 'image.url')
      }

      const sessionId = await _h.addUserSession(user)

      if (decodedState.next) {
        return _h.redirect(`${decodedState.next}${sessionId}`, 302)
      } else {
        return _h.json({ key: sessionId })
      }
    } else {
      const state = jwt.sign({ next: params.next }, jwtSecret, {
        audience: _.get(event, 'requestContext.identity.sourceIp'),
        expiresIn: '5m'
      })

      const query = querystring.stringify({
        client_id: googleId,
        redirect_uri: `https://${event.headers.Host}${event.path}`,
        response_type: 'code',
        scope: 'https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email',
        state: state
      })

      return _h.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${query}`, 302)
    }
  } catch (e) {
    return _h.error(e)
  }
}

const getToken = async (event) => {
  const googleId = await _h.ssmParameter('entu-api-google-id')
  const googleSecret = await _h.ssmParameter('entu-api-google-secret')

  return new Promise((resolve, reject) => {
    const query = querystring.stringify({
      client_id: googleId,
      client_secret: googleSecret,
      redirect_uri: `https://${event.headers.Host}${event.path}`,
      code: event.queryStringParameters.code,
      grant_type: 'authorization_code'
    })

    const options = {
      host: 'www.googleapis.com',
      port: 443,
      method: 'POST',
      path: '/oauth2/v4/token',
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

const getProfile = async (accessToken) => {
  return new Promise((resolve, reject) => {
    const query = querystring.stringify({
      access_token: accessToken
    })

    https.get(`https://www.googleapis.com/plus/v1/people/me?${query}`, (res) => {
      let data = ''

      res.on('data', (chunk) => {
        data += chunk
      })

      res.on('end', () => {
        data = JSON.parse(data)

        if (res.statusCode === 200) {
          resolve(data)
        } else {
          reject(_.get(data, 'error_description', data))
        }
      })
    }).on('error', err => {
      reject(err)
    })
  })
}
