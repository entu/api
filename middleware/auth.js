export default defineEventHandler((event) => {
  const path = getRoutePath(event)

  if (isContextFreeRoute(event.method, path)) return

  const isNewRoute = event.method === 'PUT' && path === '/new'
  const authRoute = isAuthRoute(event.method, path)

  // Routes without an account (database) path parameter — JWT is still verified when present
  const accountless = authRoute || isNewRoute
  const account = accountless ? undefined : formatDatabaseName(path.split('/').at(1))

  if (!accountless && !account) {
    throw createError({
      statusCode: 401,
      statusMessage: 'No account parameter'
    })
  }

  // The auth routes read their own credential - an API key or session token there is not an access token
  event.context.entu = {
    ...(authRoute ? { ip: authRequestIp(event) } : authReadToken(event, account)),
    account
  }
})
