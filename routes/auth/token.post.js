defineRouteMeta({
  openAPI: {
    tags: ['Authentication'],
    description: 'Exchange an authorization code for a 12-hour JWT, scoped to the authorized database. Codes are single use and expire in five minutes. Unlike tokens from `/auth`, this one is not tied to an IP address.',
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
                description: 'Only the authorization code grant is supported'
              },
              code: { type: 'string', description: 'Code received at the redirect URI' },
              redirect_uri: {
                type: 'string',
                description: 'Must match the one used at /auth/authorize',
                example: 'https://your-app.com/callback'
              },
              code_verifier: { type: 'string', description: 'Verifier for the challenge sent at /auth/authorize' }
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
                access_token: { type: 'string', description: '12-hour JWT — send as `Authorization: Bearer <token>`' },
                token_type: { type: 'string', example: 'Bearer' },
                expires_in: { type: 'integer', description: 'Seconds until the token expires', example: 43200 }
              }
            }
          }
        }
      },
      400: {
        description: 'Unknown, expired or already used code, redirect_uri mismatch, failed PKCE verification, or no access to the authorized database',
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
