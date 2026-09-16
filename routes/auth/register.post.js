defineRouteMeta({
  openAPI: {
    tags: ['Authentication'],
    summary: 'Register an OAuth client',
    description: 'RFC 7591 dynamic client registration. The returned client_id is a signed token carrying its own redirect URIs - nothing is stored server side.',
    responses: {
      201: { description: 'Registered client' },
      400: { description: 'Invalid redirect_uris' }
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
