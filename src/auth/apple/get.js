'use strict'

const _ = require('lodash')
const _h = require('../../_helpers')
const jwt = require('jsonwebtoken')
const querystring = require('querystring')

exports.handler = async (event, context) => {
  if (event.source === 'aws.events') { return }

  try {
    const params = _.get(event, 'queryStringParameters') || {}

    const jwtSecret = await _h.ssmParameter('entu-api-jwt-secret')
    const appleId = await _h.ssmParameter('entu-api-apple-id')

    const state = jwt.sign({ next: params.next }, jwtSecret, {
      audience: _.get(event, 'requestContext.identity.sourceIp'),
      expiresIn: '5m'
    })

    const query = querystring.stringify({
      client_id: appleId,
      redirect_uri: `https://${event.headers.Host}${event.path}`,
      response_type: 'code',
      response_mode: 'form_post',
      scope: 'email name',
      state: state
    })

    return _h.redirect(`https://appleid.apple.com/auth/authorize?${query}`, 302)
  } catch (e) {
    return _h.error(e)
  }
}
