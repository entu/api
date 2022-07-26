'use strict'

const _h = require('helpers')
const jwt = require('jsonwebtoken')

exports.handler = async (event, context) => {
  if (event.source === 'aws.events') { return _h.json({ message: 'OK' }) }

  try {
    const jwtSecret = await _h.ssmParameter('jwt-secret')
    const clientId = await _h.ssmParameter('google-id')

    const state = jwt.sign({ next: event.queryStringParameters?.next }, jwtSecret, {
      audience: event.requestContext?.http?.sourceIp,
      expiresIn: '5m'
    })

    const url = new URL('https://accounts.google.com')
    url.pathname = '/o/oauth2/v2/auth'
    url.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: `https://${_h.getHeader(event, 'host')}${event.rawPath}`,
      response_type: 'code',
      response_mode: 'form_post',
      scope: 'https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email',
      state
    }).toString()

    return _h.redirect(url)
  } catch (e) {
    return _h.error(e)
  }
}
