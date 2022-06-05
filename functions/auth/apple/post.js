'use strict'

const _h = require('helpers')
const https = require('https')
const jwt = require('jsonwebtoken')
const querystring = require('querystring')

exports.handler = async (event, context) => {
  if (event.source === 'aws.events') { return _h.json({ message: 'OK' }) }

  try {
    const jwtSecret = await _h.ssmParameter('jwt-secret')
    const params = _h.getBody(event)

    if (!params.state) { return _h.error([400, 'No state']) }

    const decodedState = jwt.verify(params.state, jwtSecret, { audience: event.requestContext?.http?.sourceIp })

    if (params.error && params.error === 'user_cancelled_authorize') {
      if (decodedState.next) {
        return _h.redirect(decodedState.next)
      } else {
        return _h.json({ message: 'user_cancelled_authorize' })
      }
    }

    if (!params.code) { return _h.error([400, 'No code']) }

    const accessToken = await getToken(params.code, `https://${_h.getHeader(event, 'host')}${event.rawPath}`)
    const profile = jwt.decode(accessToken)
    const profileUser = params.user ? JSON.parse(params.user) : {}
    const user = {
      ip: event.requestContext?.http?.sourceIp,
      provider: 'apple',
      id: profile.sub
    }

    if (profileUser.name?.firstName || profileUser.name?.lastName) {
      user.name = `${profileUser.name?.firstName} ${profileUser.name?.lastName}`.trim()
    }
    if (profileUser.email) {
      user.email = profileUser.email
    }

    const sessionId = await _h.addUserSession(user)

    if (decodedState.next) {
      return _h.redirect(`${decodedState.next}${sessionId}`)
    } else {
      return _h.json({ key: sessionId })
    }
  } catch (e) {
    return _h.error(e)
  }
}

const getToken = async (code, redirectUri) => {
  const appleTeam = await _h.ssmParameter('apple-team')
  const appleSecret = await _h.ssmParameter('apple-secret')

  const clientId = await _h.ssmParameter('apple-id')
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
      code,
      redirect_uri: redirectUri,
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
          reject(data.error?.data)
        }
      })
    }).on('error', (err) => {
      reject(err)
    }).write(query)
  })
}
