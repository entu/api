// Top-level route names, which shadow account names at /[db] and can never be a database
export const reservedDatabaseNames = ['auth', 'docs', 'graphql', 'mcp', 'new', 'openapi', 'stripe']

// Request path without query string and one trailing slash, as the router matches it
export function getRoutePath (event) {
  const path = event.path.split('?').at(0)

  return path.length > 2 && path.endsWith('/') ? path.slice(0, -1) : path
}

// True when the request goes to a route that builds its own context, so the auth and mongodb middlewares skip it; CORS preflights are answered by the cors middleware
export function isContextFreeRoute (method, path) {
  return method === 'OPTIONS'
    || ['/', '/_openapi.json', '/docs', '/openapi'].includes(path)
    || (method === 'GET' && path === '/.well-known/oauth-authorization-server')
    || (method === 'GET' && /^\/mcp\/\.well-known\/oauth-protected-resource\/[^/]+$/.test(path))
    || (method === 'POST' && path === '/stripe')
    || (method === 'POST' && /^\/mcp\/[^/]+$/.test(path))
    || (method === 'GET' && /^\/new\/[^/]+$/.test(path))
    || /^\/graphql\/[^/]+$/.test(path)
}

// True for the routes in routes/auth/, which have no account in the path; GET /auth/<x> is the [provider] route
export function isAuthRoute (method, path) {
  return (method === 'GET' && /^\/auth(\/[^/]+)?$/.test(path))
    || (method === 'POST' && /^\/auth\/(passkey|register|token)$/.test(path))
}
