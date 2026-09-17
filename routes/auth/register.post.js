defineRouteMeta({
  openAPI: {
    tags: ['Authentication'],
    description: 'Register an OAuth client (RFC 7591). There is no client secret — the `client_id` carries its own redirect URIs and is valid for a year. Store it rather than registering again on every start.',
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
                description: 'Where the user may be returned after login — 1 to 10 URIs',
                items: { type: 'string', example: 'https://your-app.com/callback' }
              },
              client_name: {
                type: 'string',
                description: 'Application name, up to 200 characters',
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
                client_id: { type: 'string', description: 'Client id to use at /auth/authorize' },
                client_name: { type: 'string' },
                redirect_uris: {
                  type: 'array',
                  items: { type: 'string' }
                },
                token_endpoint_auth_method: { type: 'string', example: 'none' },
                grant_types: {
                  type: 'array',
                  items: { type: 'string', example: 'authorization_code' }
                },
                response_types: {
                  type: 'array',
                  items: { type: 'string', example: 'code' }
                }
              }
            }
          }
        }
      },
      400: {
        description: 'Missing redirect_uris, more than 10 of them, or one that is not a valid URI',
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
