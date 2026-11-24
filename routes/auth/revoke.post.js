defineRouteMeta({
  openAPI: {
    tags: ['Authentication'],
    description: 'Revoke a refresh token (RFC 7009) from an OAuth client or `/auth`, ending its sign-in - access tokens already issued work until they expire. See [Signing out](https://entu.ee/api/authentication/#signing-out).',
    security: [], // The refresh token itself is the credential being revoked
    requestBody: {
      required: true,
      content: {
        'application/x-www-form-urlencoded': {
          schema: {
            type: 'object',
            properties: {
              token: { type: 'string', description: 'Refresh token' },
              token_type_hint: { type: 'string', description: 'Ignored' }
            },
            required: ['token']
          }
        },
        'application/json': {
          schema: {
            type: 'object',
            description: 'Same fields as JSON',
            properties: {
              token: { type: 'string' },
              token_type_hint: { type: 'string' }
            },
            required: ['token']
          }
        }
      }
    },
    responses: {
      200: {
        description: 'Revoked, or nothing to revoke',
        content: { 'application/json': { schema: { type: 'object' } } }
      },
      400: {
        description: '`data.error`: `invalid_request` — no token',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      }
    }
  }
})

export default defineEventHandler(async (event) => {
  const body = await oauthReadBody(event)

  if (typeof body?.token !== 'string' || !body.token) {
    throw oauthError('invalid_request', 'No token')
  }

  // An access token or an unknown token also gets 200 - RFC 7009 tells a client nothing about tokens it can't revoke
  await sessionRevoke(event, body.token)

  return {}
})
