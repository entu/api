// Called by the webapp consent page with the databases the user picked - returns where to send the browser: the OAuth client with a code, or with access_denied
defineRouteMeta({ openAPI: { hidden: true } })

export default defineEventHandler(async (event) => {
  const body = await event.req.json().catch(() => {})
  const consent = oauthVerifyConsent(event, body?.consent)
  const picked = Array.isArray(body?.accounts) ? [...new Set(body.accounts)] : []

  if (picked.length > 100 || picked.some((x) => typeof x !== 'string')) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid database list' })
  }

  const url = new URL(consent.redirectUri)

  // The webapp navigates to this address itself, so a script scheme must never come back from here
  if (['javascript:', 'data:', 'vbscript:', 'blob:'].includes(url.protocol)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid redirect_uri' })
  }

  if (consent.clientState) {
    url.searchParams.set('state', consent.clientState)
  }

  if (picked.length === 0) {
    url.searchParams.set('error', 'access_denied')
    url.searchParams.set('error_description', 'The user shared no database')

    return { redirect: url.toString() }
  }

  // A request that named its database can only be confirmed for that one; the token exchange then checks the user is, or becomes, a person there
  if (consent.account && (picked.length !== 1 || picked.at(0) !== consent.account)) {
    throw createError({ statusCode: 403, statusMessage: `Only database ${consent.account} was requested` })
  }

  // Checked again here, so a database the user is no person in - one open to them only through support access - can't be added to the request
  if (!consent.account) {
    const accounts = (await authSessionAccounts(consent.session)).map((a) => a.account)

    for (const account of picked) {
      if (!accounts.includes(account)) {
        throw createError({ statusCode: 403, statusMessage: `No access to database ${account}` })
      }
    }
  }

  url.searchParams.set('code', oauthSign(event, 'code', {
    ...(consent.account ? { account: consent.account } : { accounts: picked }),
    codeChallenge: consent.codeChallenge,
    redirectUri: consent.redirectUri,
    session: consent.session
  }))

  return { redirect: url.toString() }
})
