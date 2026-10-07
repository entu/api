// Called only by Entu's own passkey page and native app - an assertion can only be made for Entu's domain
defineRouteMeta({
  openAPI: {
    hidden: true,
    tags: ['Authentication'],
    description: 'Sign in with a stored passkey: without `state` returns a JWT as `GET /auth` does, with `state` a single-use `code` for `/auth/callback`. See [OAuth](https://entu.ee/api/authentication/#oauth) for passkey matching.',
    security: [], // The passkey assertion authenticates this call, not a JWT
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            description: 'WebAuthn response plus challenge token',
            properties: {
              id: { type: 'string', description: 'base64url credential ID' },
              rawId: { type: 'string', description: 'base64url credential ID' },
              type: { type: 'string', enum: ['public-key'] },
              response: {
                type: 'object',
                description: 'Authenticator assertion',
                properties: {
                  clientDataJSON: { type: 'string', description: 'base64url' },
                  authenticatorData: { type: 'string', description: 'base64url' },
                  signature: { type: 'string', description: 'base64url' },
                  userHandle: { type: 'string', description: 'base64url' }
                },
                required: ['clientDataJSON', 'authenticatorData', 'signature']
              },
              challengeToken: { type: 'string', description: 'From `GET /auth/passkey/options`' },
              state: { type: 'string', description: 'Passkey page login state — omit for native sign-in' },
              db: { type: 'string', description: 'Native sign-in: as `db` on `GET /auth`' },
              invite: { type: 'string', description: 'Native sign-in: as `invite` on `GET /auth`' }
            },
            required: ['id', 'rawId', 'type', 'response', 'challengeToken']
          }
        }
      }
    },
    responses: {
      200: {
        description: 'Without `state`: JWT and databases. With `state`: `{ code }`',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                code: { type: 'string', description: 'Single-use code for `/auth/callback` — one minute, this IP' },
                accounts: {
                  type: 'array',
                  description: 'Accessible databases',
                  items: {
                    type: 'object',
                    properties: {
                      _id: { type: 'string', description: 'Database name', example: 'mydatabase' },
                      name: { type: 'string', description: 'Database name', example: 'mydatabase' },
                      user: {
                        type: 'object',
                        description: 'Person entity signed in as',
                        properties: {
                          _id: { type: 'string', description: 'Person entity ID', example: '6798938432faaba00f8fc72f' },
                          name: { type: 'string', description: 'Person name, or ID', example: 'User 1' }
                        }
                      }
                    }
                  }
                },
                user: {
                  type: 'object',
                  description: 'Passkey identity',
                  properties: {
                    uid: { type: 'string', description: 'Credential ID' },
                    provider: { type: 'string', enum: ['passkey'] },
                    name: { type: 'string', description: 'Person name in the first database, by name, that has one' },
                    passkeyPublic: { type: 'string', description: 'Passkey public key' },
                    device: { type: 'string', description: 'Passkey device name' }
                  }
                },
                token: { type: 'string', description: '12-hour JWT, bound to this IP' },
                expires: { type: 'string', format: 'date-time', description: 'Token expiry' }
              }
            }
          }
        }
      },
      400: {
        description: 'Invalid, expired or wrong-IP `challengeToken` or `state`; non-string credential ID; no matching stored passkey; `Invalid or expired invite`',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      }
    }
  }
})

export default defineEventHandler(async (event) => {
  const body = (await event.req.json().catch(() => {})) || {}

  // Checked before verifying, so a passkey prompt for a login from another browser never creates a session
  if (body.state) {
    oauthVerifyPasskeyState(event, body.state)
  }

  return await passkeyFinish(event, await passkeyVerifySignIn(event, body), body)
})
