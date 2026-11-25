// Called by the webapp consent page to list the databases an OAuth client may be given - only those the user is a person in, or the one the request named
defineRouteMeta({ openAPI: { hidden: true } })

export default defineEventHandler(async (event) => {
  const consent = oauthVerifyConsent(event, getQuery(event).consent)
  const found = await authSessionAccounts(consent.session)
  const redirectUri = new URL(consent.redirectUri)

  // A named database is offered even before the user is a person in it, as automatic user creation may add them at the token exchange
  const accounts = consent.account
    ? [consent.account]
    : found.map((a) => a.account)

  return {
    client: consent.clientName,
    // A custom-scheme redirect (com.example.app:/callback) has no host, so its scheme names the app instead
    host: redirectUri.host || redirectUri.protocol,
    accounts: accounts
      .map((account) => ({ _id: account }))
      .toSorted((a, b) => a._id.localeCompare(b._id))
  }
})
