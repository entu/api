'use strict'

const _h = require('helpers')
const jwt = require('jsonwebtoken')
const querystring = require('querystring')

exports.handler = async (event, context) => {
  if (event.source === 'aws.events') { return _h.json({ message: 'OK' }) }

  try {
    const jwtSecret = await _h.ssmParameter('jwt-secret')
    const clientId = await _h.ssmParameter('google-id')

    const state = jwt.sign({ next: event.queryStringParameters?.next }, jwtSecret, {
      audience: event.requestContext?.http?.sourceIp,
      expiresIn: '5m'
    })

    const query = querystring.stringify({
      client_id: clientId,
      redirect_uri: `https://${_h.getHeader(event, 'host')}${event.rawPath}`,
      response_type: 'code',
      response_mode: 'form_post',
      scope: 'https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email',
      state
    })

    return _h.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${query}`)
  } catch (e) {
    return _h.error(e)
  }
}
