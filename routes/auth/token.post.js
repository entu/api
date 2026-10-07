defineRouteMeta({
  openAPI: {
    tags: ['Authentication'],
    description: 'Exchange an authorization code for a 12-hour JWT that is not IP-bound and cannot be refreshed. See [Exchange the code](https://entu.ee/api/authentication/#exchange-the-code).',
    security: [], // The code and PKCE verifier authenticate this call, not a JWT
    requestBody: {
      required: true,
      content: {
        'application/x-www-form-urlencoded': {
          schema: {
            type: 'object',
            properties: {
              grant_type: {
                type: 'string',
                enum: ['authorization_code'],
                description: 'Only `authorization_code`'
              },
              code: { type: 'string', description: 'From the redirect URI' },
              redirect_uri: {
                type: 'string',
                description: 'Same as at `/auth/authorize`',
                example: 'https://your-app.com/callback'
              },
              code_verifier: { type: 'string', description: 'PKCE verifier' }
            },
            required: ['grant_type', 'code', 'redirect_uri', 'code_verifier']
          }
        },
        'application/json': {
          schema: {
            type: 'object',
            description: 'Same fields as JSON',
            properties: {
              grant_type: { type: 'string', enum: ['authorization_code'] },
              code: { type: 'string' },
              redirect_uri: { type: 'string' },
              code_verifier: { type: 'string' }
            },
            required: ['grant_type', 'code', 'redirect_uri', 'code_verifier']
          }
        }
      }
    },
    responses: {
      200: {
        description: 'Access token',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                access_token: { type: 'string', description: '12-hour JWT (`use: access`), not IP-bound' },
                token_type: { type: 'string', enum: ['Bearer'] },
                expires_in: { type: 'integer', description: 'Seconds to expiry', example: 43200 }
              },
              required: ['access_token', 'token_type', 'expires_in']
            }
          }
        }
      },
      400: {
        description: '`data.error`: `unsupported_grant_type`, or `invalid_grant` — bad, expired or used code, `redirect_uri` mismatch, PKCE failure, no database access',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      }
    }
  }
})

export default defineEventHandler(async (event) => {
  const body = await readTokenBody(event)

  if (body?.grant_type !== 'authorization_code') {
    throw oauthError('unsupported_grant_type', 'Only grant_type=authorization_code is supported')
  }

  const code = oauthVerify(event, 'code', body.code)

  if (code.redirectUri !== body.redirect_uri) {
    throw oauthError('invalid_grant', 'redirect_uri does not match the authorization request')
  }

  if (!oauthVerifyChallenge(body.code_verifier, code.codeChallenge)) {
    throw oauthError('invalid_grant', 'PKCE verification failed')
  }

  // The code carries only the session id, so nothing here is a credential an interceptor could have used. The issued
  // JWT is not bound to an address - an OAuth client calls from its own servers, never from the browser
  const auth = await authExchange(event, {
    account: code.account,
    bindIp: false,
    sessionId: code.session
  }).catch(() => {})

  if (!auth?.token) {
    throw oauthError('invalid_grant', 'Session could not be exchanged')
  }

  if (!auth.accounts?.some((account) => account._id === code.account)) {
    throw oauthError('invalid_grant', `No access to database ${code.account}`)
  }

  return {
    access_token: auth.token,
    token_type: 'Bearer',
    expires_in: Math.max(0, Math.floor((new Date(auth.expires).getTime() - Date.now()) / 1000))
  }
})

// Token requests are form-encoded by default, but some clients send JSON - accept both
async function readTokenBody (event) {
  if ((event.req.headers.get('content-type') || '').includes('json')) {
    return await event.req.json().catch(() => {})
  }

  return Object.fromEntries(new URLSearchParams(await event.req.text()))
}
