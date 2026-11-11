import { createHmac } from 'node:crypto'

export function logger (message, entu, messageTags) {
  const messageArray = []
  const db = entu?.account
  const user = !entu?.systemUser && entu?.userStr ? entu?.userStr : undefined

  if (db) {
    messageArray.push(`db:${db}`)
  }
  if (user) {
    messageArray.push(`user:${user}`)
  }
  if (entu?.support) {
    messageArray.push(`support:${supportLogId(entu.support)}`)
  }
  if (messageTags) {
    messageArray.push(...messageTags)
  }
  if (message) {
    messageArray.push(`- ${message}`)
  }

  console.log(messageArray.join(' '))
}

export function loggerError (message, entu, messageTags) {
  const messageArray = ['ERROR']
  const db = entu?.account
  const user = !entu?.systemUser && entu?.userStr ? entu?.userStr : undefined

  if (db) {
    messageArray.push(`db:${db}`)
  }
  if (user) {
    messageArray.push(`user:${user}`)
  }
  if (entu?.support) {
    messageArray.push(`support:${supportLogId(entu.support)}`)
  }
  if (messageTags) {
    messageArray.push(...messageTags)
  }
  if (message) {
    messageArray.push(`- ${message}`)
  }

  console.error(messageArray.join(' '))
}

// A short keyed hash of the support login id, so logs tell staff apart without anyone being able to work back to the personal ID code
function supportLogId (uid) {
  return createHmac('sha256', useRuntimeConfig().jwtSecret).update(uid).digest('hex').slice(0, 12)
}
