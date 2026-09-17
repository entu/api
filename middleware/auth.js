import jwt from 'jsonwebtoken'

export default defineEventHandler((event) => {
  const path = event.path.split('?').at(0)

  if (path === '/') return
  if (path === '/_openapi.json') return
  if (path.startsWith('/.well-known/')) return
  if (path === '/docs' || path.startsWith('/docs/')) return
  if (path === '/graphql' || path.startsWith('/graphql/')) return
  if (path === '/mcp' || path.startsWith('/mcp/')) return
  if (path === '/openapi' || path.startsWith('/openapi/')) return
  if (path === '/stripe' || path.startsWith('/stripe/')) return

  const isNewRoute = path === '/new' || path.startsWith('/new/')

  if (isNewRoute && event.method !== 'PUT') return

  const isAuthRoute = path === '/auth' || path.startsWith('/auth/')

  // Routes without an account (database) path parameter — JWT is still verified when present
  const accountless = isAuthRoute || isNewRoute

  const entu = {
    ip: (getRequestIP(event, { xForwardedFor: true }) || '127.0.0.1').replace('::1', '127.0.0.1'),
    account: accountless ? undefined : formatDatabaseName(path.split('/').at(1))
  }

  if (!accountless && !entu.account) {
    throw createError({
      statusCode: 401,
      statusMessage: 'No account parameter'
    })
  }

  entu.tokenStr = (event.req.headers.get('authorization') || '').replace('Bearer ', '').trim()

  if (!isAuthRoute && entu.tokenStr) {
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
