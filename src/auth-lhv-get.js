'use strict'

const _ = require('lodash')
const _h = require('./_helpers')
const crypto = require('crypto')

exports.handler = async (event, context) => {
  if (event.source === 'aws.events') { return }

  try {
    const lhvId = await _h.ssmParameter('entu-api-lhv-id')
    const lhvKey = await _h.ssmParameter('entu-api-lhv-key')
    const next = _.get(event, 'queryStringParameters.next')

    const data = {
      VK_SERVICE: '4011',
      VK_VERSION: '008',
      VK_SND_ID: lhvId,
      VK_REPLY: '3012',
      VK_RETURN: next ? 'https://api.entu.app/auth/lhv?next=' + next : 'https://api.entu.app/auth/lhv',
      VK_DATETIME: (new Date()).toISOString().substr(0, 19) + 'Z',
      VK_RID: '',
      VK_MAC: null,
      VK_ENCODING: 'UTF-8',
      VK_LANG: 'EST',
    }

    const macDataArray = [
      ('000' + data.VK_SERVICE.length).slice(-3),
      data.VK_SERVICE,
      ('000' + data.VK_VERSION.length).slice(-3),
      data.VK_VERSION,
      ('000' + data.VK_SND_ID.length).slice(-3),
      data.VK_SND_ID,
      ('000' + data.VK_REPLY.length).slice(-3),
      data.VK_REPLY,
      ('000' + data.VK_RETURN.length).slice(-3),
      data.VK_RETURN,
      ('000' + data.VK_DATETIME.length).slice(-3),
      data.VK_DATETIME,
      ('000' + data.VK_RID.length).slice(-3),
      data.VK_RID
    ]

    data.VK_MAC = crypto.createSign('SHA1').update(macDataArray.join('')).sign(lhvKey, 'base64')

    return _h.json({ url: 'https://www.lhv.ee/banklink', signedRequest: data })
  } catch (e) {
    return _h.error(e)
  }
}
