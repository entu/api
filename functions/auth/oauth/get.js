'use strict'

const _h = require('helpers')
const jwt = require('jsonwebtoken')

exports.handler = async (event, context) => {
  if (event.source === 'aws.events') return _h.json({ message: 'OK' })

  try {
    const jwtSecret = await _h.ssmParameter('jwt-secret')
    const clientId = await _h.ssmParameter('oauth-id')
    const provider = event.pathParameters?.provider

    const state = jwt.sign({ next: event.queryStringParameters?.next }, jwtSecret, {
      audience: event.requestContext?.http?.sourceIp,
      expiresIn: '5m'
    })

    const url = new URL('https://oauth.ee')
    url.pathname = `/auth/${provider}`
    url.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: `https://${_h.getHeader(event, 'host')}${event.rawPath}`,
      response_type: 'code',
      scope: 'openid',
      state
    }).toString()

    return _h.redirect(url)
  } catch (e) {
    return _h.error(e)
  }
}
