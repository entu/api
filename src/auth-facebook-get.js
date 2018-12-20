'use strict'

const _ = require('lodash')
const _h = require('./_helpers')
const https = require('https')
const querystring = require('querystring')

exports.handler = async (event, context) => {
  if (event.source === 'aws.events') { return }

  const facebookId = await _h.ssmParameter('entu-api-facebook-id')

  try {
    if (!_.has(event, 'queryStringParameters.code') && !_.has(event, 'queryStringParameters.error')) {
      const query = querystring.stringify({
        client_id: facebookId,
        redirect_uri: `https://${event.headers.Host}${event.path}`,
        response_type: 'code',
        scope: 'public_profile,email',
        state: _.get(event, 'queryStringParameters.next')
      })

      return _h.redirect(`https://www.facebook.com/dialog/oauth?${query}`, 302)
    } else if (_.has(event, 'queryStringParameters.error')) {
      return _h.error(event.queryStringParameters.error_description)
    } else {
      const accessToken = await getToken(event)
      const profile = await getProfile(accessToken)
      const user = {
        provider: 'facebook',
        id: _.get(profile, 'id'),
        name: _.get(profile, 'name'),
        email: _.get(profile, 'email'),
        picture: _.get(profile, 'picture.data.url')
      }
      const sessionId = await _h.addUserSession(user)

      if (_.has(event, 'queryStringParameters.state')) {
        return _h.redirect(`${event.queryStringParameters.state}${sessionId}`, 302)
      } else {
        return _h.json({ key: sessionId })
      }
    }
  } catch (e) {
    return _h.error(e)
  }
}

const getToken = async (event) => {
  const facebookId = await _h.ssmParameter('entu-api-facebook-id')
  const facebookSecret = await _h.ssmParameter('entu-api-facebook-secret')

  return new Promise((resolve, reject) => {
    const query = querystring.stringify({
      client_id: facebookId,
      client_secret: facebookSecret,
      redirect_uri: `https://${event.headers.Host}${event.path}`,
      code: event.queryStringParameters.code
    })

    https.get(`https://graph.facebook.com/oauth/access_token?${query}`, (res) => {
      let data = ''

      res.on('data', (chunk) => {
        data += chunk
      })

      res.on('end', () => {
        data = JSON.parse(data)

        if (res.statusCode === 200 && data.access_token) {
          resolve(data.access_token)
        } else {
          reject(_.get(data, 'error.message', data))
        }
      })
    }).on('error', err => {
      reject(err)
    })
  })
}

const getProfile = async (accessToken) => {
  return new Promise((resolve, reject) => {
    const query = querystring.stringify({
      access_token: accessToken,
      fields: 'id,name,email,picture'
    })

    https.get(`https://graph.facebook.com/me?${query}`, (res) => {
      let data = ''

      res.on('data', (chunk) => {
        data += chunk
      })

      res.on('end', () => {
        data = JSON.parse(data)

        if (res.statusCode === 200) {
          resolve(data)
        } else {
          reject(_.get(data, 'error.message', data))
        }
      })
    }).on('error', err => {
      reject(err)
    })
  })
}
