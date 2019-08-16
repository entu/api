'use strict'

const _ = require('lodash')
const _h = require('./_helpers')
const https = require('https')
const querystring = require('querystring')

exports.handler = async (event, context) => {
  if (event.source === 'aws.events') { return }

  const appleId = await _h.ssmParameter('entu-api-apple-id')

  try {
    if (!_.has(event, 'queryStringParameters.code') && !_.has(event, 'queryStringParameters.error')) {
      const query = querystring.stringify({
        client_id: appleId,
        redirect_uri: `https://${event.headers.Host}${event.path}`,
        response_type: 'code',
        scope: 'name email',
        state: _.get(event, 'queryStringParameters.next')
      })

      return _h.redirect(`https://appleid.apple.com/auth/authorize?${query}`, 302)
    } else if (_.has(event, 'queryStringParameters.error')) {
      return _h.error(event.queryStringParameters.error_description)
    } else {
      return _h.json({ data: 'queryStringParameters' })
    }
  } catch (e) {
    return _h.error(e)
  }
}
