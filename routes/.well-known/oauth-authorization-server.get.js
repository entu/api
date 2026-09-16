defineRouteMeta({
  openAPI: {
    tags: ['Authentication'],
    summary: 'OAuth authorization server metadata',
    description: 'RFC 8414 discovery document for the Entu OAuth 2.1 authorization server.',
    responses: { 200: { description: 'Authorization server metadata' } }
  }
})

export default defineEventHandler((event) => {
  const base = oauthBaseUrl(event)

  return {
    issuer: base,
    authorization_endpoint: `${base}/auth/authorize`,
    token_endpoint: `${base}/auth/token`,
    registration_endpoint: `${base}/auth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none']
  }
})
