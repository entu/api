// Called only by Entu's own passkey page and native app - signs in with a stored passkey: `{ code }` with `state`, else the GET /auth response
defineRouteMeta({ openAPI: { hidden: true } })

export default defineEventHandler(async (event) => {
  const body = (await event.req.json().catch(() => {})) || {}

  // Checked before verifying, so a passkey prompt for a login from another browser never creates a session
  if (body.state) {
    oauthVerifyPasskeyState(event, body.state)
  }

  return await passkeyFinish(event, await passkeyVerifySignIn(event, body), body)
})
