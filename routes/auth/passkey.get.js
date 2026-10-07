import { generateAuthenticationOptions } from '@simplewebauthn/server'

defineRouteMeta({
  openAPI: {
    tags: ['Authentication'],
    description: 'With `next`, start a passkey login like `/auth/{provider}` - the user signs in on the Entu passkey page and returns to `next` with a session token appended, to exchange at `/auth`. Without `next`, return WebAuthn authentication options for a native passkey sign-in.',
    security: [], // The user is not authenticated yet — that is what this starts
    parameters: [
      {
        name: 'next',
        in: 'query',
        schema: {
          type: 'string',
          description: 'URL to return to, with the session token appended. Omit to get the WebAuthn options instead'
        }
      }
    ],
    responses: {
      200: { description: 'WebAuthn authentication options with a `challengeToken` to send back to `POST /auth/passkey`' },
      302: { description: 'Redirect to the Entu passkey page' }
    }
  }
})

export default defineEventHandler(async (event) => {
  const { passkeyRpId } = useRuntimeConfig(event)

  // `/auth/passkey` shadows the passkey provider of `/auth/{provider}`, so the login starts here
  if (getQuery(event).next) {
    return oauthStartLogin(event, { provider: 'passkey' })
  }

  const options = await generateAuthenticationOptions({
    rpID: passkeyRpId,
    userVerification: 'preferred',
    allowCredentials: []
  })

  return { ...options, challengeToken: passkeySignChallenge(event, options.challenge) }
})
