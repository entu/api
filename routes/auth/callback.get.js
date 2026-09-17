// Internal step of the authorization flow — only /auth/{provider} redirects here, so kept out of the API docs
defineRouteMeta({ openAPI: { hidden: true } })

export default defineEventHandler((event) => {
  const query = getQuery(event)

  if (!query.token) {
    throw oauthError('invalid_request', 'No session token')
  }

  const state = oauthVerify(event, 'state', query.state)

  // The session is not exchanged here - that happens at the token endpoint, so the JWT audience is the client's IP
  const code = oauthSign(event, 'code', {
    account: state.account,
    codeChallenge: state.codeChallenge,
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
