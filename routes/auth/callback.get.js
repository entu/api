// Internal step of the authorization flow — only /auth/{provider} redirects here, so kept out of the API docs
defineRouteMeta({ openAPI: { hidden: true } })

export default defineEventHandler((event) => {
  const query = getQuery(event)

  if (!query.token) {
    throw oauthError('invalid_request', 'No session token')
  }

  const state = oauthVerify(event, 'state', query.state)

  // The browser's address travels with the code because the session token is bound to it, and only the token
  // endpoint - called later by the client, from a different address - can exchange it
  const code = oauthSign(event, 'code', {
    account: state.account,
    codeChallenge: state.codeChallenge,
    ip: (getRequestIP(event, { xForwardedFor: true }) || '127.0.0.1').replace('::1', '127.0.0.1'),
    redirectUri: state.redirectUri,
    session: query.token
  })

  const url = new URL(state.redirectUri)

  url.searchParams.set('code', code)

  if (state.clientState) {
    url.searchParams.set('state', state.clientState)
  }

  return sendRedirect(event, url.toString(), 302)
})
