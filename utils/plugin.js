import jwt from 'jsonwebtoken'
import logger from './logger.js'

export async function triggerWebhooks (entu, entityId, pluginType) {
  // Get all plugins of the specified type
  const plugins = await entu.db.collection('entity').find({
    'private._type.string': 'plugin',
    'private.type.string': pluginType,
    'private.url.string': { $exists: true }
  }, {
    projection: { 'private.url.string': true }
  }).toArray()

  if (!plugins?.length)
    return

  // Get the entity
  const entity = await entu.db.collection('entity').findOne({ _id: entityId }, { projection: { 'private._type.reference': true } })

  if (!entity)
    return

  // Get the entity type (only with plugins)
  const entityType = await entu.db.collection('entity').findOne({
    _id: entity.private?._type?.at(0)?.reference,
    'private.plugin.reference': {
      $in: plugins.map((plugin) => plugin._id)
    }
  }, {
    projection: { 'private.plugin': true }
  })

  if (!entityType)
    return

  const webhooks = entityType.private.plugin.flatMap((x) => {
    return plugins.find((p) => p._id.toString() === x.reference.toString())?.private?.url?.map((url) => url.string)
  }).filter(Boolean)

  // Generate temporary token for webhook (1 minute expiration, no IP restriction)
  const { jwtSecret } = useRuntimeConfig()
  const tokenData = {}

  // Add user email if available
  if (entu.email) {
    tokenData.user = {
      email: entu.email
    }
  }

  tokenData.accounts = {
    [entu.account]: entu.userStr
  }

  const token = jwt.sign(tokenData, jwtSecret, {
    expiresIn: '1m'
  })

  // Make POST requests to each webhook without waiting
  for (const webhookUrl of webhooks) {
    logger(`Triggering webhook ${webhookUrl}`, entu, [`entity:${entityId}`])

    fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        db: entu.account,
        plugin: pluginType,
        entity: {
          _id: entityId
        },
        token
      })
    }).catch((error) => {
      console.error(`Webhook request failed for ${entityId} ${webhookUrl}:`, error)
    })
  }
}
