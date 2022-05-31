'use strict'

const _h = require('../../_helpers')
const crypto = require('crypto')

const strWithLength = (str) => {
  return ('000' + str.length).slice(-3) + str
}

exports.handler = async (event, context) => {
  if (event.source === 'aws.events') { return _h.json({ message: 'OK' }) }

  try {
    const lhvId = await _h.ssmParameter('lhv-id')
    const lhvKey = await _h.ssmParameter('lhv-key')
    const domain = await _h.ssmParameter('domain')
    const next = event.queryStringParameters?.next

    const request = {
      VK_SERVICE: '4011',
      VK_VERSION: '008',
      VK_SND_ID: lhvId,
      VK_REPLY: '3012',
      VK_RETURN: `https://${domain}/auth/lhv?next=${next || ''}`,
      VK_DATETIME: (new Date()).toISOString().substr(0, 19) + 'Z',
      VK_RID: '',
      VK_MAC: null,
      VK_ENCODING: 'UTF-8',
      VK_LANG: 'EST'
    }

    const mac = [
      request.VK_SERVICE,
      request.VK_VERSION,
      request.VK_SND_ID,
      request.VK_REPLY,
      request.VK_RETURN,
      request.VK_DATETIME,
      request.VK_RID
    ].map(strWithLength).join('')

    request.VK_MAC = crypto.createSign('SHA1').update(mac).sign(lhvKey, 'base64')

    return _h.json({ url: 'https://www.lhv.ee/banklink', signedRequest: request })
  } catch (e) {
    return _h.error(e)
  }
}
