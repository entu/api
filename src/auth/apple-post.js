'use strict'

const _ = require('lodash')
const _h = require('../_helpers')
const https = require('https')
const jwt = require('jsonwebtoken')
const querystring = require('querystring')

exports.handler = async (event, context) => {
  if (event.source === 'aws.events') { return }

  try {
    const jwtSecret = await _h.ssmParameter('entu-api-jwt-secret')
    const appleId = await _h.ssmParameter('entu-api-apple-id')
    const params = querystring.parse(event.body) || {}

    if (!params.state) { return _h.error([400, 'No state']) }

    const decodedState = jwt.verify(params.state, jwtSecret, { audience: _.get(event, 'requestContext.identity.sourceIp') })

    if (params.error && params.error === 'user_cancelled_authorize') {
      if (decodedState.next) {
        return _h.redirect(`${decodedState.next}`, 302)
      } else {
        return _h.json({ message: 'user_cancelled_authorize' })
      }
    }

    if (!params.id_token) { return _h.error([400, 'No id_token']) }

    const profile = jwt.decode(params.id_token)
    const profile_user = params.user ? JSON.parse(params.user) : {}
    const user = {
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
