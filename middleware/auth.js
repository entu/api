import jwt from 'jsonwebtoken'

export default defineEventHandler((event) => {
  if (event.path === '/') return
  if (event.path === '/docs' || event.path.startsWith('/docs/')) return
  if (event.path.startsWith('/_openapi')) return

  const isNewRoute = event.path === '/new' || event.path.startsWith('/new/')

  if (isNewRoute && event.method !== 'PUT') return
  if (event.path.startsWith('/openapi')) return
  if (event.path.startsWith('/graphql')) return
  if (event.path.startsWith('/stripe')) return

  // Routes without an account (database) path parameter — JWT is still verified when present
  const accountless = event.path.startsWith('/auth') || isNewRoute

  const entu = {
    ip: (getRequestIP(event, { xForwardedFor: true }) || '127.0.0.1').replace('::1', '127.0.0.1'),
    account: accountless ? undefined : formatDatabaseName(event.path.split('/').at(1))
  }

  if (!accountless && !entu.account) {
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
