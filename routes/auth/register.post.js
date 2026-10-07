defineRouteMeta({
  openAPI: {
    tags: ['Authentication'],
    description: 'Register an OAuth client (RFC 7591), without a client secret. See [Register a client](https://entu.ee/api/authentication/#register-a-client).',
    security: [], // Registration is open — the client is not yet known
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              redirect_uris: {
                type: 'array',
                description: '1–10 absolute URIs, any scheme',
                minItems: 1,
                maxItems: 10,
                items: { type: 'string', format: 'uri', example: 'https://your-app.com/callback' }
              },
              client_name: {
                type: 'string',
                description: 'App name, cut to 200 characters',
                example: 'My App'
              }
            },
            required: ['redirect_uris']
          }
        }
      }
    },
    responses: {
      201: {
        description: 'Registered client',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                client_id: { type: 'string', description: 'Valid for a year' },
                client_name: { type: 'string', description: 'Absent if not given' },
                redirect_uris: {
                  type: 'array',
                  items: { type: 'string' }
                },
                token_endpoint_auth_method: { type: 'string', enum: ['none'] },
                grant_types: {
                  type: 'array',
                  items: { type: 'string', enum: ['authorization_code'] }
                },
                response_types: {
                  type: 'array',
                  items: { type: 'string', enum: ['code'] }
                }
              },
              required: ['client_id', 'redirect_uris', 'token_endpoint_auth_method', 'grant_types', 'response_types']
            }
          }
        }
      },
      400: {
        description: '`invalid_redirect_uri` — missing, empty, over 10, or invalid URIs',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
      }
    }
  }
})

export default defineEventHandler(async (event) => {
  const body = await event.req.json().catch(() => {})
  const redirectUris = body?.redirect_uris

  if (!Array.isArray(redirectUris) || redirectUris.length === 0 || redirectUris.length > 10) {
    throw oauthError('invalid_redirect_uri', 'redirect_uris must be an array of 1 to 10 URIs')
  }

  for (const uri of redirectUris) {
    if (typeof uri !== 'string' || !URL.canParse(uri)) {
      throw oauthError('invalid_redirect_uri', `${uri} is not a valid URI`)
    }
  }

  const name = typeof body?.client_name === 'string' ? body.client_name.slice(0, 200) : undefined

  setResponseStatus(event, 201)

  return {
    client_id: oauthSign(event, 'client', { name, redirectUris }),
    client_name: name,
    redirect_uris: redirectUris,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code'],
    response_types: ['code']
  }
})
