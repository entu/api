'use strict'

const _h = require('./_helpers')

exports.handler = async (event, context) => {
  if (event.source === 'aws.events') { return }

  try {
    console.log(event.body)

    return _h.json({ status: 'ok' })
  } catch (e) {
    return _h.error(e)
  }
}
