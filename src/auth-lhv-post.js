'use strict'

const _ = require('lodash')
const _h = require('./_helpers')
const crypto = require('crypto')
const querystring = require('querystring')

const strWithLength = (str) => {
  return ('000' + str.length).slice(-3) + str
}

exports.handler = async (event, context) => {
  if (event.source === 'aws.events') { return }

  try {
    const lhvId = await _h.ssmParameter('entu-api-lhv-id')
    const lhvKey = await _h.ssmParameter('entu-api-lhv-public')
    const next = _.get(event, 'queryStringParameters.next')

    const request = querystring.parse(event.body)

    const mac = [
      request.VK_SERVICE,
      request.VK_VERSION,
      request.VK_USER,
      request.VK_DATETIME,
      request.VK_SND_ID,
      request.VK_REC_ID,
      request.VK_USER_NAME,
      request.VK_USER_ID,
      request.VK_COUNTRY,
      request.VK_OTHER,
      request.VK_TOKEN,
      request.VK_RID
    ].map(strWithLength).join('')

    const now = new Date()
    const datetime = new Date(request.VK_DATETIME)
    const datetimeMin = new Date(datetime.getTime() - 300000)
    const datetimeMax = new Date(datetime.getTime() + 300000)

    if (!crypto.createVerify('SHA1').update(mac).verify(lhvKey, data.VK_MAC, 'base64')) {
      return _h.error([400, 'Invalid VK_MAC.'])
    }
    if (_.get(request, 'VK_SERVICE') !== '3012') {
      return _h.error([400, 'Invalid VK_SERVICE.'])
    }
    if (_.get(request, 'VK_SND_ID') !== 'LHV') {
      return _h.error([400, 'Invalid VK_SND_ID.'])
    }
    if (_.get(request, 'VK_REC_ID') !== lhvId) {
      return _h.error([400, 'Invalid VK_REC_ID.'])
    }
    if (now < datetimeMin || now > datetimeMax) {
      return _h.error([400, 'Invalid VK_DATETIME.'])
    }

    const user = {
      provider: 'lhv',
      id: _.get(request, 'VK_USER_ID'),
      name: _.get(request, 'VK_USER_NAME'),
      email: _.get(request, 'VK_USER_ID') + '@eesti.ee'
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
