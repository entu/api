// Called only by Entu's own passkey page and native app - WebAuthn creation options plus a challengeToken for POST /auth/passkey/register
defineRouteMeta({ openAPI: { hidden: true } })

export default defineEventHandler(async (event) => await passkeyRegisterOptions(event))
