// Called only by Entu's own passkey page and native app - WebAuthn sign-in options plus a challengeToken for POST /auth/passkey
defineRouteMeta({ openAPI: { hidden: true } })

export default defineEventHandler(async (event) => await passkeySignInOptions(event))
