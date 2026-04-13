import jwt from 'jsonwebtoken'

export default defineEventHandler((event) => {
  if (event.path === '/docs' || event.path.startsWith('/docs/'))
    return
  if (event.path.startsWith('/_openapi'))
    return
  if (event.path.startsWith('/new'))
    return
  if (event.path.startsWith('/openapi'))
    return
  if (event.path.startsWith('/stripe'))
    return

  const entu = {
    ip: (getRequestIP(event, { xForwardedFor: true }) || '127.0.0.1').replace('::1', '127.0.0.1'),
    account: event.path.startsWith('/auth') ? undefined : formatDatabaseName(event.path.split('/').at(1))
  }

  if (!event.path.startsWith('/auth') && !entu.account) {
    throw createError({
      statusCode: 401,
      statusMessage: 'No account parameter'
    })
  }

  entu.tokenStr = (event.req.headers.get('authorization') || '').replace('Bearer ', '').trim()

  if (!event.path.startsWith('/auth') && entu.tokenStr) {
    try {
      const { jwtSecret } = useRuntimeConfig(event)
      entu.token = jwt.verify(entu.tokenStr, jwtSecret)

      // Only verify audience if token contains it (for IP-restricted tokens)
      if (entu.token.aud && entu.token.aud !== entu.ip) {
        throw createError({
          statusCode: 401,
          statusMessage: 'Invalid JWT audience'
        })
      }

      if (entu.account && entu.token.accounts?.[entu.account]) {
        entu.user = getObjectId(entu.token.accounts[entu.account])
        entu.userStr = entu.token.accounts[entu.account]
      }

      if (entu.token?.user?.email) {
        entu.email = entu.token.user.email
      }
    }
    catch (e) {
      throw createError({
        statusCode: 401,
        statusMessage: e.message || e
      })
    }
  }

  event.context.entu = entu
})
