// Called only by Entu's own passkey page and native app - an assertion can only be made for Entu's domain
defineRouteMeta({
  openAPI: {
    hidden: true,
    tags: ['Authentication'],
    description: 'WebAuthn options for signing in with a stored passkey; send the assertion with `challengeToken` to `POST /auth/passkey` from the same IP within five minutes.',
    security: [], // The user is not authenticated yet — that is what this prepares
    responses: {
      200: {
        description: 'WebAuthn authentication options',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                challenge: { type: 'string', description: 'base64url WebAuthn challenge' },
                rpId: { type: 'string', description: 'Relying party ID', example: 'entu.app' },
                allowCredentials: {
                  type: 'array',
                  description: 'Always empty — any passkey may answer',
                  items: { type: 'object' }
                },
                timeout: { type: 'integer', description: 'Prompt timeout in ms', example: 60000 },
                userVerification: { type: 'string', enum: ['preferred'] },
                challengeToken: { type: 'string', description: 'For `POST /auth/passkey` — five minutes, this IP only' }
              },
              required: ['challenge', 'rpId', 'allowCredentials', 'userVerification', 'challengeToken']
            }
          }
        }
      }
    }
  }
})

export default defineEventHandler(async (event) => await passkeySignInOptions(event))
