'use strict'

const _ = require('lodash')
const _h = require('./_helpers')
const https = require('https')
const jwt = require('jsonwebtoken')
const querystring = require('querystring')

exports.handler = async (event, context) => {
  if (event.source === 'aws.events') { return }

  try {
    const params = _.get(event, 'queryStringParameters') || {}

    const jwtSecret = await _h.ssmParameter('entu-api-jwt-secret')
    const appleId = await _h.ssmParameter('entu-api-apple-id')

    if (params.error) {
      return _h.error(params.error_description)
    } else if (params.code && params.state) {
      const decodedState = jwt.verify(params.state, jwtSecret, { audience: _.get(event, 'requestContext.identity.sourceIp') })
      const accessToken = await getToken(event)
      const profile = jwt.decode(accessToken)
      const user = {
        provider: 'apple',
        id: _.get(profile, 'sub'),
        email: _.get(profile, 'email'),
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
        client_id: appleId,
        redirect_uri: `https://${event.headers.Host}${event.path}`,
        response_type: 'code',
        scope: 'name email',
        state: state
      })

      return _h.redirect(`https://appleid.apple.com/auth/authorize?${query}`, 302)
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
    expiresIn: '10s',
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

        if (res.statusCode === 200 && data.access_token && data.id_token) {
          resolve(data.id_token)
        } else {
          reject(_.get(data, 'error_description', data))
        }
      })
    }).on('error', err => {
      reject(err)
    }).write(query)
  })
}
