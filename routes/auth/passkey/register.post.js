// Called only by Entu's own passkey page and native app - creates a passkey and signs in with it: `{ code }` with `state`, else the GET /auth response
defineRouteMeta({ openAPI: { hidden: true } })

export default defineEventHandler(async (event) => {
  const body = (await event.req.json().catch(() => {})) || {}

  // Checked before verifying, so a passkey created for a login from another browser never creates a session
  if (body.state) {
    oauthVerifyPasskeyState(event, body.state, { register: true })
  }

  return await passkeyFinish(event, await passkeyVerifyRegister(event, body), body)
})
