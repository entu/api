'use strict'

const _ = require('lodash')
const _h = require('../../_helpers')
const https = require('https')
const jwt = require('jsonwebtoken')
const querystring = require('querystring')

exports.handler = async (event, context) => {
  if (event.source === 'aws.events') { return _h.json({ message: 'OK' }) }

  try {
    const jwtSecret = await _h.ssmParameter('entu-api-jwt-secret')
    const params = _h.getBody(event)

    if (!params.state) { return _h.error([400, 'No state']) }

    const decodedState = jwt.verify(params.state, jwtSecret, { audience: _.get(event, 'requestContext.identity.sourceIp') })

    if (params.error && params.error === 'user_cancelled_authorize') {
      if (decodedState.next) {
        return _h.redirect(`${decodedState.next}`, 302)
      } else {
        return _h.json({ message: 'user_cancelled_authorize' })
      }
    }

    if (!params.code) { return _h.error([400, 'No code']) }

    const accessToken = await getToken(params.code, `https://${event.headers.Host}${event.path}`)
    const profile = jwt.decode(accessToken)
    const profile_user = params.user ? JSON.parse(params.user) : {}
    const user = {
      ip: _.get(event, 'requestContext.identity.sourceIp'),
      provider: 'apple',
      id: _.get(profile, 'sub')
    }

    if (_.get(profile_user, 'name.firstName') || _.get(profile_user, 'name.lastName')) {
      user.name = `${_.get(profile_user, 'name.firstName', '')} ${_.get(profile_user, 'name.lastName', '')}`.trim()
    }
    if (_.get(profile_user, 'email')) {
      user.email = _.get(profile_user, 'email')
    }

    const sessionId = await _h.addUserSession(user)

    if (decodedState.next) {
      return _h.redirect(`${decodedState.next}${sessionId}`, 302)
    } else {
      return _h.json({ key: sessionId })
    }
  } catch (e) {
    return _h.error(e)
  }
}

const getToken = async (code, redirect_uri) => {
  const appleTeam = await _h.ssmParameter('entu-api-apple-team')
  const appleSecret = await _h.ssmParameter('entu-api-apple-secret')

  const clientId = await _h.ssmParameter('entu-api-apple-id')
  const clientSecret = jwt.sign({}, appleSecret, {
    issuer: appleTeam,
    audience: 'https://appleid.apple.com',
    subject: clientId,
    expiresIn: '5m',
    algorithm: 'ES256'
  })

  return new Promise((resolve, reject) => {
    const query = querystring.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code: code,
      redirect_uri: redirect_uri,
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
          reject(_.get(data, 'error', data))
        }
      })
    }).on('error', (err) => {
      reject(err)
    }).write(query)
  })
}
