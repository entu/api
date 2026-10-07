// Called only by Entu's own passkey page and native app - a passkey can only be created for Entu's domain
defineRouteMeta({
  openAPI: {
    hidden: true,
    tags: ['Authentication'],
    description: 'WebAuthn options for creating a new passkey, labelled Entu; send the result with `challengeToken` to `POST /auth/passkey/register` from the same IP within five minutes.',
    security: [], // Creating a passkey needs no account — it is how a new user signs up
    responses: {
      200: {
        description: '`PublicKeyCredentialCreationOptionsJSON` with `challengeToken`',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                challenge: { type: 'string', description: 'base64url WebAuthn challenge' },
                rp: {
                  type: 'object',
                  properties: {
                    name: { type: 'string', example: 'Entu' },
                    id: { type: 'string', description: 'Relying party ID', example: 'entu.app' }
                  }
                },
                user: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', description: 'Random base64url user handle' },
                    name: { type: 'string', example: 'Entu' },
                    displayName: { type: 'string', description: 'Always empty' }
                  }
                },
                pubKeyCredParams: {
                  type: 'array',
                  description: 'ES256 (-7) and RS256 (-257)',
                  items: { type: 'object' }
                },
                timeout: { type: 'integer', example: 60000 },
                attestation: { type: 'string', example: 'none' },
                excludeCredentials: { type: 'array', description: 'Always empty', items: { type: 'object' } },
                authenticatorSelection: {
                  type: 'object',
                  properties: {
                    residentKey: { type: 'string', example: 'required' },
                    userVerification: { type: 'string', example: 'preferred' },
                    requireResidentKey: { type: 'boolean', example: true }
                  }
                },
                challengeToken: { type: 'string', description: 'For `POST /auth/passkey/register` — five minutes, this IP only' }
              },
              required: ['challenge', 'rp', 'user', 'pubKeyCredParams', 'challengeToken']
            }
          }
        }
      }
    }
  }
})

export default defineEventHandler(async (event) => await passkeyRegisterOptions(event))
