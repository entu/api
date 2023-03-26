'use strict'

const _h = require('helpers')
const https = require('https')
const jwt = require('jsonwebtoken')

exports.handler = async (event, context) => {
  if (event.source === 'aws.events') return _h.json({ message: 'OK' })

  try {
    const jwtSecret = await _h.ssmParameter('jwt-secret')
    const params = _h.getBody(event)

    if (!params.state) return _h.error([400, 'No state'])

    const decodedState = jwt.verify(params.state, jwtSecret, { audience: event.requestContext?.http?.sourceIp })

    if (params.error) return _h.error({ 400: params.error })

    if (!params.code) return _h.error([400, 'No code'])

    const accessToken = await getToken(params.code, `https://${_h.getHeader(event, 'host')}${event.rawPath}`)
    const profile = await getProfile(accessToken)
    const user = {
      ip: event.requestContext?.http?.sourceIp,
      provider: profile.provider,
      id: profile.id,
      name: profile.name,
      email: profile.email
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

const getToken = async (code) => {
  const clientId = await _h.ssmParameter('oauth-id')
  const clientSecret = await _h.ssmParameter('oauth-secret')

  return new Promise((resolve, reject) => {
    const query = JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code'
    })

    const options = {
      host: 'oauth.ee',
      port: 443,
      method: 'POST',
      path: '/api/token',
      headers: {
        'Content-Type': 'application/json',
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
          reject(data)
        }
      })
    }).on('error', (err) => {
      reject(err)
    }).write(query)
  })
}

const getProfile = async (accessToken) => {
  return new Promise((resolve, reject) => {
    const url = new URL('https://oauth.ee')
    url.pathname = '/api/user'
    url.search = new URLSearchParams({
      access_token: accessToken
    }).toString()

    https.get(url, (res) => {
      let data = ''

      res.on('data', (chunk) => {
        data += chunk
      })

      res.on('end', () => {
        data = JSON.parse(data)

        if (res.statusCode === 200) {
          resolve(data)
        } else {
          reject(data)
        }
      })
    }).on('error', (err) => {
      reject(err)
    })
  })
}
