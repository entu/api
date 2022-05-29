'use strict'

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

    const decodedState = jwt.verify(params.state, jwtSecret, { audience: event.requestContext?.http?.sourceIp })

    if (params.error) { return _h.error([400, params.error]) }

    if (!params.code) { return _h.error([400, 'No code']) }

    const accessToken = await getToken(params.code, `https://${_h.getHeader(event, 'host')}${event.rawPath}`)
    const profile = await getProfile(accessToken)
    const user = {
      ip: event.requestContext?.http?.sourceIp,
      provider: 'google',
      id: profile.id,
      name: profile.displayName,
      email: profile.emails[0]?.value,
      picture: profile.image?.url
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
  const clientId = await _h.ssmParameter('entu-api-google-id')
  const clientSecret = await _h.ssmParameter('entu-api-google-secret')

  return new Promise((resolve, reject) => {
    const query = querystring.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
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
          reject(data.error_description?.data)
        }
      })
    }).on('error', (err) => {
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
          reject(data.error_description?.data)
        }
      })
    }).on('error', (err) => {
      reject(err)
    })
  })
}
