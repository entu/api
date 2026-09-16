defineRouteMeta({
  openAPI: {
    tags: ['Authentication'],
    summary: 'OAuth provider callback',
    description: 'Receives the temporary session token from the Entu provider login, wraps it into an authorization code and returns the user to the client.',
    responses: {
      302: { description: 'Redirect back to the client redirect_uri' },
      400: { description: 'Invalid or expired authorization state' }
    }
  }
})

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
