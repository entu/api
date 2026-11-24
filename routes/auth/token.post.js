defineRouteMeta({
  openAPI: {
    tags: ['Authentication'],
    description: 'Exchange an authorization code, or a refresh token, for a 12-hour JWT that is not IP-bound and a new refresh token. See [Exchange the code](https://entu.ee/api/authentication/#exchange-the-code) and [Refresh](https://entu.ee/api/authentication/#refresh-an-oauth-token).',
    security: [], // The code and PKCE verifier, or the refresh token, authenticate this call, not a JWT
    requestBody: {
      required: true,
      content: {
        'application/x-www-form-urlencoded': {
          schema: {
            type: 'object',
            properties: {
              grant_type: {
                type: 'string',
                enum: ['authorization_code', 'refresh_token']
              },
              code: { type: 'string', description: '`authorization_code`: from the redirect URI' },
              redirect_uri: {
                type: 'string',
                description: '`authorization_code`: same as at `/auth/authorize`',
                example: 'https://your-app.com/callback'
              },
              code_verifier: { type: 'string', description: '`authorization_code`: PKCE verifier' },
              refresh_token: { type: 'string', description: '`refresh_token`: the latest refresh token' }
            },
            required: ['grant_type']
          }
        },
        'application/json': {
          schema: {
            type: 'object',
            description: 'Same fields as JSON',
            properties: {
              grant_type: { type: 'string', enum: ['authorization_code', 'refresh_token'] },
              code: { type: 'string' },
              redirect_uri: { type: 'string' },
              code_verifier: { type: 'string' },
              refresh_token: { type: 'string' }
            },
            required: ['grant_type']
          }
        }
      }
    },
    responses: {
      200: {
        description: 'Access token and refresh token',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                access_token: { type: 'string', description: '12-hour JWT (`use: access`), not IP-bound' },
                token_type: { type: 'string', enum: ['Bearer'] },
                expires_in: { type: 'integer', description: 'Seconds to expiry', example: 43200 },
                refresh_token: { type: 'string', description: 'Single use - replaces the previous one; works for 7 days, and never past 30 days after sign-in' }
              },
              required: ['access_token', 'token_type', 'expires_in', 'refresh_token']
            }
          }
        }
      },
      400: {
        description: '`data.error`: `unsupported_grant_type`, or `invalid_grant` — bad, expired or used code or refresh token, `redirect_uri` mismatch, PKCE failure, no database access',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      }
    }
  }
})

export default defineEventHandler(async (event) => {
  const body = await oauthReadBody(event)

  // Like the code exchange, a refresh reaches only the consented databases and never lists support
  if (body?.grant_type === 'refresh_token') {
    return tokenResponse(await sessionRefresh(event, body.refresh_token, { oauth: true }))
  }

  if (body?.grant_type !== 'authorization_code') {
    throw oauthError('unsupported_grant_type', 'Only grant_type=authorization_code and refresh_token are supported')
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
  // A code names one database from the authorization request, or the databases the user picked on the consent page - never none, which would mean all
  const databases = code.accounts || [code.account]

  if (databases.length === 0 || databases.some((database) => typeof database !== 'string' || !database)) {
    throw oauthError('invalid_grant', 'Code names no database')
  }

  const auth = await authExchange(event, {
    account: code.account,
    accounts: code.accounts,
    bindIp: false,
    refreshable: false,
    listSupport: false,
    offerRename: false,
    sessionId: code.session
  }).catch(() => {})

  if (!auth?.token) {
    throw oauthError('invalid_grant', 'Session could not be exchanged')
  }

  for (const database of databases) {
    if (!auth.accounts?.some((account) => account._id === database)) {
      throw oauthError('invalid_grant', `No access to database ${database}`)
    }
  }

  const refreshToken = await sessionKeep(event, code.session, { accounts: databases, client: code.client })

  return tokenResponse({ ...auth, refreshToken })
})

// The RFC 6749 token response for an issued access token and its refresh token
function tokenResponse (auth) {
  return {
    access_token: auth.token,
    token_type: 'Bearer',
    expires_in: Math.max(0, Math.floor((new Date(auth.expires).getTime() - Date.now()) / 1000)),
    refresh_token: auth.refreshToken
  }
}
