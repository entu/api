export default function logger (message, entu, messageTags) {
  const messageArray = []
  const db = entu?.account
  const user = !entu?.systemUser && entu?.userStr ? entu?.userStr : undefined

  if (db) {
    messageArray.push(`db:${db}`)
  }
  if (user) {
    messageArray.push(`user:${user}`)
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
  if (messageTags) {
    messageArray.push(...messageTags)
  }
  if (message) {
    messageArray.push(`- ${message}`)
  }

  console.error(messageArray.join(' '))
}
