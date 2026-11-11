// Called by the webapp consent page to list the databases an OAuth client may be given - only those the user is a person in, or the one the request named
defineRouteMeta({ openAPI: { hidden: true } })

export default defineEventHandler(async (event) => {
  const consent = oauthVerifyConsent(event, getQuery(event).consent)
  const found = await authSessionAccounts(consent.session)
  const redirectUri = new URL(consent.redirectUri)

  // A named database is offered even before the user is a person in it, as automatic user creation may add them at the token exchange
  const accounts = consent.account
    ? [found.find((a) => a.account === consent.account) || { account: consent.account }]
    : found

  return {
    client: consent.clientName,
    // A custom-scheme redirect (com.example.app:/callback) has no host, so its scheme names the app instead
    host: redirectUri.host || redirectUri.protocol,
    accounts: accounts
      .map((a) => ({ _id: a.account, ...(a.userId ? { user: { name: a.userName || a.userId.toString() } } : {}) }))
      .toSorted((a, b) => a._id.localeCompare(b._id))
  }
})
