// Where OAuth.ee returns an authorization started at /auth/authorize - never called by hand, so kept out of the docs
defineRouteMeta({ openAPI: { hidden: true } })

export default defineEventHandler(async (event) => {
  const { code, error, state } = getQuery(event)

  if (error) {
    throw oauthError('access_denied', error)
  }

  if (!code || !state) {
    throw oauthError('invalid_request', 'No authorization to complete')
  }

  const login = await oauthCompleteLogin(event, code, state)

  // A plain login carries no authorization, so it hands the session token straight back
  if (!login.state.redirectUri) {
    if (login.state.next) {
      return redirect(`${login.state.next}${login.sessionId}`, 302)
    }

    return { key: login.sessionId }
  }

  const url = new URL(login.state.redirectUri)

  url.searchParams.set('code', oauthSign(event, 'code', {
    account: login.state.account,
    codeChallenge: login.state.codeChallenge,
    ip: login.ip,
    redirectUri: login.state.redirectUri,
    session: login.sessionId
  }))

  if (login.state.clientState) {
    url.searchParams.set('state', login.state.clientState)
  }

  return sendRedirect(event, url.toString(), 302)
})
