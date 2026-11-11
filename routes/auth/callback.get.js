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
      return redirect(`${login.state.next}${login.token}`, 302)
    }

    return { key: login.token }
  }

  // Every authorization goes to the webapp consent page, which completes it at /auth/consent - a sign-in alone never hands a client a code
  const url = new URL('/auth/consent', useRuntimeConfig(event).appUrl)

  url.searchParams.set('consent', oauthSignConsent(event, {
    ...(login.state.account ? { account: login.state.account } : {}),
    clientName: login.state.clientName,
    clientState: login.state.clientState,
    codeChallenge: login.state.codeChallenge,
    redirectUri: login.state.redirectUri,
    session: login.id
  }))

  return sendRedirect(event, url.toString(), 302)
})
