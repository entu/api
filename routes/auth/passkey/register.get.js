// Called only by the Entu webapp - starts a browser login that creates a new passkey, the passkey twin of /auth/{provider}
defineRouteMeta({ openAPI: { hidden: true } })

export default defineEventHandler((event) => oauthStartLogin(event, { provider: 'passkey', register: true }))
