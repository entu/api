'use strict'

const _ = require('lodash')
const _h = require('./_helpers')
const aws = require('aws-sdk')
const https = require('https')
const querystring = require('querystring')

exports.handler = async (event, context) => {
  if (event.source === 'aws.events') { return }

  const ssm = new aws.SSM()
  const googleId = await ssm.getParameter({ Name: 'entu-api-google-id', WithDecryption: true }).promise()

  try {
    if (!_.has(event, 'queryStringParameters.code') && !_.has(event, 'queryStringParameters.error')) {
      const query = querystring.stringify({
        client_id: googleId.Parameter.Value,
        redirect_uri: `https://${event.headers.Host}${event.path}`,
        response_type: 'code',
        scope: 'https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email',
        state: _.get(event, 'queryStringParameters.next')
      })

      return _h.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${query}`, 302)
    } else if (_.has(event, 'queryStringParameters.error')) {
      return _h.error(event.queryStringParameters.error_description)
    } else {
      const accessToken = await getToken(event)
      const profile = await getProfile(accessToken)
      const user = {
        provider: 'google',
        id: _.get(profile, 'id'),
        name: _.get(profile, 'displayName'),
        email: _.get(profile, 'emails.0.value'),
        picture: _.get(profile, 'image.url')
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
  const ssm = new aws.SSM()
  const googleId = await ssm.getParameter({ Name: 'entu-api-google-id', WithDecryption: true }).promise()
  const googleSecret = await ssm.getParameter({ Name: 'entu-api-google-secret', WithDecryption: true }).promise()

  return new Promise((resolve, reject) => {
    const query = querystring.stringify({
      client_id: googleId.Parameter.Value,
      client_secret: googleSecret.Parameter.Value,
      redirect_uri: `https://${event.headers.Host}${event.path}`,
      code: event.queryStringParameters.code,
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
          reject(_.get(data, 'error_description', data))
        }
      })
    }).on('error', err => {
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
          reject(_.get(data, 'error_description', data))
        }
      })
    }).on('error', err => {
      reject(err)
    })
  })
}
