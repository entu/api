defineRouteMeta({ openAPI: { hidden: true } })

export default defineEventHandler(async (event) => {
  const body = await event.req.json().catch(() => {})
  const ip = (getRequestIP(event, { xForwardedFor: true }) || '127.0.0.1').replace('::1', '127.0.0.1')

  // Checked before verifying, so a passkey prompt for a login from another browser never creates a session
  if (body?.state) {
    oauthVerifyPasskeyState(event, body.state)
  }

  const user = await passkeyVerify(event, body || {})

  // The passkey page of a login started at /auth/passkey or /auth/authorize gets a single-use code for /auth/callback
  if (body.state) {
    const sessionId = await oauthCreateSession(ip, user, { pending: true })

    return { code: oauthSignPasskeyCode(event, sessionId, body.state) }
  }

  // A native sign-in gets the same response as any other login exchanged at /auth
  const sessionId = await oauthCreateSession(ip, user)

  return await authExchange(event, { ip, sessionId })
})
