// Called only by Entu's own passkey page and native app - a passkey can only be created for Entu's domain
defineRouteMeta({
  openAPI: {
    hidden: true,
    tags: ['Authentication'],
    description: 'Create a new passkey and sign in with it: without `state` returns a JWT as `GET /auth` does, with `state` a single-use `code` for `/auth/callback`. The passkey is stored on a person when an invite, automatic user creation or `PUT /new` links it.',
    security: [], // The new passkey authenticates this call, not a JWT
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            description: 'WebAuthn `RegistrationResponseJSON` plus challenge token',
            properties: {
              id: { type: 'string', description: 'base64url credential ID' },
              rawId: { type: 'string', description: 'base64url credential ID' },
              type: { type: 'string', enum: ['public-key'] },
              response: {
                type: 'object',
                required: ['clientDataJSON', 'attestationObject'],
                properties: {
                  clientDataJSON: { type: 'string' },
                  attestationObject: { type: 'string' },
                  transports: { type: 'array', items: { type: 'string' } }
                }
              },
              challengeToken: { type: 'string', description: 'From `GET /auth/passkey/register/options`' },
              deviceName: { type: 'string', maxLength: 100, description: 'Passkey label, default `Unknown Device`' },
              state: { type: 'string', description: 'Passkey page login state — omit for native sign-up' },
              db: { type: 'string', description: 'Native sign-up: as `db` on `GET /auth`' },
              invite: { type: 'string', description: 'Native sign-up: as `invite` on `GET /auth`' }
            },
            required: ['id', 'rawId', 'type', 'response', 'challengeToken']
          }
        }
      }
    },
    responses: {
      200: {
        description: 'Without `state`: JWT and databases as from `GET /auth`, `user.registered` true. With `state`: `{ code }` for `/auth/callback`'
      },
      400: {
        description: 'Invalid, expired or wrong-IP `challengeToken` or `state`; verification failed; credential ID already registered; `Invalid or expired invite`',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      }
    }
  }
})

export default defineEventHandler(async (event) => {
  const body = (await event.req.json().catch(() => {})) || {}

  // Checked before verifying, so a passkey created for a login from another browser never creates a session
  if (body.state) {
    oauthVerifyPasskeyState(event, body.state, { register: true })
  }

  return await passkeyFinish(event, await passkeyVerifyRegister(event, body), body)
})
