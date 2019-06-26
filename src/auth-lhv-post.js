'use strict'

const _ = require('lodash')
const _h = require('./_helpers')
const crypto = require('crypto')
const querystring = require('querystring')

exports.handler = async (event, context) => {
  if (event.source === 'aws.events') { return }

  try {
    const lhvId = await _h.ssmParameter('entu-api-lhv-id')
    const lhvKey = await _h.ssmParameter('entu-api-lhv-key')
    const next = _.get(event, 'queryStringParameters.next')

    const profile = querystring.parse(event.body)

    const user = {
      provider: 'lhv',
      id: _.get(profile, 'VK_USER_ID'),
      name: _.get(profile, 'VK_USER_NAME'),
      email: _.get(profile, 'VK_USER_ID') + '@eesti.ee'
    }
    const sessionId = await _h.addUserSession(user)

    if (_.has(event, 'queryStringParameters.next')) {
      return _h.redirect(`${event.queryStringParameters.next}${sessionId}`, 302)
    } else {
      return _h.json({ key: sessionId })
    }
  } catch (e) {
    return _h.error(e)
  }
}
